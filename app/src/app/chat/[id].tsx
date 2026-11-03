import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import type { Draft } from "@ai-reply-for-whatsapp/shared";
import { useCreateDraft, useMessages, useSend } from "../../api/queries";
import { useSpeech } from "../../speech/use-speech";
import { MessageBubble } from "../../components/message-bubble";

export default function ChatScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const chatId = id ?? "";

  const { data: messagesData } = useMessages(chatId);
  const createDraft = useCreateDraft(chatId);
  const send = useSend(chatId);
  const speech = useSpeech();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editedText, setEditedText] = useState("");
  const listRef = useRef<FlatList>(null);
  /** Id of the newest message the list last auto-scrolled to. */
  const lastScrolledId = useRef<string | null>(null);

  const messages = messagesData?.messages ?? [];

  useEffect(() => {
    // Recording finished with a transcript -> ask Claude for a draft.
    if (!speech.recording && speech.transcript && !createDraft.isPending) {
      const prompt = speech.transcript;
      speech.reset();
      createDraft.mutate(
        { prompt, previousDraftId: draft?.id },
        {
          onSuccess: ({ draft: newDraft }) => {
            setDraft(newDraft);
            setEditedText(newDraft.draft);
          },
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.recording, speech.transcript]);

  const onSend = () => {
    if (!editedText.trim()) return;
    send.mutate(
      { text: editedText.trim(), draftId: draft?.id },
      {
        onSuccess: () => {
          setDraft(null);
          setEditedText("");
        },
      },
    );
  };

  const busy = createDraft.isPending || send.isPending || speech.transcribing;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      <Stack.Screen options={{ title: name ?? chatId }} />
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <MessageBubble message={item} isGroup={chatId.endsWith("@g.us")} />}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => {
          // Jump to the end only when a message actually arrived (or on first
          // layout). Re-measurements caused by background refetches must not
          // move the list — and must never yank the user out of history.
          const lastId = messages[messages.length - 1]?.id ?? null;
          if (lastId && lastId !== lastScrolledId.current) {
            lastScrolledId.current = lastId;
            listRef.current?.scrollToEnd({ animated: false });
          }
        }}
      />

      {speech.error ? <Text style={styles.error}>{speech.error}</Text> : null}
      {createDraft.error ? <Text style={styles.error}>{String(createDraft.error)}</Text> : null}
      {send.error ? <Text style={styles.error}>{String(send.error)}</Text> : null}

      {speech.recording || speech.transcribing ? (
        <View style={styles.transcriptBox}>
          <Text style={styles.transcriptLabel}>
            {speech.recording ? "Listening… tap Stop when done" : "Transcribing…"}
          </Text>
        </View>
      ) : null}

      {draft ? (
        <View style={styles.draftBox}>
          <Text style={styles.draftLabel}>Draft — edit if needed, then send</Text>
          <TextInput
            style={styles.draftInput}
            value={editedText}
            onChangeText={setEditedText}
            multiline
          />
          <View style={styles.draftActions}>
            <Pressable
              style={[styles.button, styles.buttonSecondary]}
              onPress={() => {
                setDraft(null);
                setEditedText("");
              }}
            >
              <Text style={styles.buttonSecondaryText}>Discard</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.buttonSecondary]}
              // Toggles, because the main record bar (with its Stop button) is
              // hidden while a draft is shown — without this there would be no
              // way to end a re-recording.
              onPress={() => void (speech.recording ? speech.stop() : speech.start())}
              disabled={busy}
            >
              <Text style={styles.buttonSecondaryText}>
                {speech.recording ? "■ Stop" : "Re-record"}
              </Text>
            </Pressable>
            <Pressable style={[styles.button, styles.buttonPrimary]} onPress={onSend} disabled={busy}>
              {send.isPending ? (
                <ActivityIndicator color="#0b141a" size="small" />
              ) : (
                <Text style={styles.buttonPrimaryText}>Send</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.recordBar}>
          {createDraft.isPending || speech.transcribing ? (
            <View style={styles.thinking}>
              <ActivityIndicator color="#00a884" />
              <Text style={styles.thinkingText}>
                {speech.transcribing ? "Transcribing…" : "Drafting reply…"}
              </Text>
            </View>
          ) : (
            <Pressable
              style={[styles.recordButton, speech.recording && styles.recordButtonActive]}
              onPress={() => void (speech.recording ? speech.stop() : speech.start())}
            >
              <Text style={styles.recordButtonText}>
                {speech.recording ? "■ Stop" : "🎙 Record reply instruction"}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b141a" },
  list: { paddingVertical: 10 },
  error: { color: "#f28b82", paddingHorizontal: 14, paddingVertical: 4, fontSize: 13 },
  transcriptBox: { backgroundColor: "#182229", padding: 12, marginHorizontal: 10, borderRadius: 10 },
  transcriptLabel: { color: "#00a884", fontSize: 12, fontWeight: "600", marginBottom: 4 },
  transcriptText: { color: "#e9edef", fontSize: 15 },
  draftBox: { backgroundColor: "#182229", margin: 10, borderRadius: 12, padding: 12 },
  draftLabel: { color: "#8696a0", fontSize: 12, marginBottom: 6 },
  draftInput: {
    color: "#e9edef",
    fontSize: 15,
    backgroundColor: "#0b141a",
    borderRadius: 8,
    padding: 10,
    minHeight: 70,
    maxHeight: 200,
    textAlignVertical: "top",
  },
  draftActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  button: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, minWidth: 76, alignItems: "center" },
  buttonPrimary: { backgroundColor: "#00a884" },
  buttonPrimaryText: { color: "#0b141a", fontWeight: "700" },
  buttonSecondary: { backgroundColor: "#233138" },
  buttonSecondaryText: { color: "#e9edef" },
  recordBar: { padding: 12 },
  recordButton: {
    backgroundColor: "#00a884",
    borderRadius: 26,
    paddingVertical: 14,
    alignItems: "center",
  },
  recordButtonActive: { backgroundColor: "#ea5455" },
  recordButtonText: { color: "#0b141a", fontSize: 16, fontWeight: "700" },
  thinking: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, paddingVertical: 14 },
  thinkingText: { color: "#8696a0", fontSize: 15 },
});
