/**
 * Speech-to-text against any OpenAI-compatible `/audio/transcriptions` endpoint.
 *
 * Apple's on-device recognizer needs a locale fixed up front and cannot detect
 * the spoken language, so it can't serve a user who switches languages between
 * chats. Whisper detects the language itself — we deliberately do not send a
 * `language` field.
 */
export class Transcriber {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
  ) {}

  async transcribe(audio: Buffer, filename: string, mimeType: string): Promise<string> {
    const form = new FormData();
    // Copy into a plain Uint8Array: Node's Buffer is typed as ArrayBufferLike,
    // which may be a SharedArrayBuffer and so isn't a valid BlobPart.
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
    form.append("model", this.model);
    form.append("response_format", "json");

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Transcription failed (${res.status} ${res.statusText}): ${detail.slice(0, 300)}`,
      );
    }

    const body = (await res.json()) as { text?: unknown };
    if (typeof body.text !== "string") {
      throw new Error("Transcription response had no `text` field");
    }
    return body.text.trim();
  }
}
