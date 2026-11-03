import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@ai-reply-for-whatsapp/shared";

const SYSTEM = `You draft WhatsApp replies on behalf of the user.

You receive the recent conversation of one chat and an instruction from the user
describing what the reply should say. Write the reply the user would send.

Rules:
- Write in the same language the conversation is held in, unless the instruction says otherwise.
- Match the user's tone and style as visible in their earlier messages (formality, emoji use, length).
- The instruction describes intent, not literal wording — phrase it naturally.
- Output ONLY the reply text itself: no quotes, no preamble, no explanation.`;

export class ReplyDrafter {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async draft(options: {
    chatName: string;
    isGroup: boolean;
    history: Message[];
    prompt: string;
    previousDraft?: string;
  }): Promise<string> {
    const { chatName, isGroup, history, prompt, previousDraft } = options;

    const transcript = history
      .map((m) => {
        const who = m.fromMe ? "Me" : (m.senderName ?? m.sender);
        // The model only sees text, so name the photo instead of an empty line.
        const text = m.media ? `[photo]${m.text ? ` ${m.text}` : ""}` : m.text;
        return `${who}: ${text}`;
      })
      .join("\n");

    const parts = [
      `Chat: ${chatName}${isGroup ? " (group chat)" : ""}`,
      `Recent conversation:\n${transcript}`,
    ];
    if (previousDraft) {
      parts.push(`Previous draft (revise it according to the instruction):\n${previousDraft}`);
    }
    parts.push(`Instruction for the reply:\n${prompt}`);

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: parts.join("\n\n") }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new Error(`Model returned no text (stop_reason: ${response.stop_reason})`);
    return text;
  }
}
