import { useCallback, useState } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { api } from "../api/client";

export interface SpeechState {
  recording: boolean;
  /** True between stopping the recording and the transcript coming back. */
  transcribing: boolean;
  /** Final transcript. Empty until transcription finishes. */
  transcript: string;
  error: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
}

/**
 * Records audio and transcribes it server-side with Whisper.
 *
 * This replaces Apple's SFSpeechRecognizer, which needs its locale fixed before
 * recording starts and cannot detect the spoken language. Whisper detects the
 * language itself, so the same button works for any language without a setting.
 *
 * The tradeoff is that there is no live transcript while speaking — text
 * arrives once the upload completes. Callers should show `transcribing`.
 */
export function useSpeech(): SpeechState {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    setTranscript("");
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError("Microphone permission denied");
        return;
      }
      // iOS silently records silence unless the session allows recording.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start recording");
      setRecording(false);
    }
  }, [recorder]);

  const stop = useCallback(async () => {
    if (!recording) return;
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("Recording produced no audio file");
      const { text } = await api.transcribe(uri);
      if (!text) {
        setError("Nothing was recognised — try speaking again");
        return;
      }
      setTranscript(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setTranscribing(false);
      // Release the recording session so normal playback volume returns.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(
        () => undefined,
      );
    }
  }, [recorder, recording]);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
  }, []);

  return { recording, transcribing, transcript, error, start, stop, reset };
}
