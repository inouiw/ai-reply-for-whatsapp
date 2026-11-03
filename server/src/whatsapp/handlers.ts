import type { proto, WAMessage } from "baileys";
import type { Message } from "@ai-reply-for-whatsapp/shared";

/** Pull the human-readable text out of the many shapes a WhatsApp message can take. */
function extractText(m: proto.IMessage | null | undefined): string | null {
  if (!m) return null;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    null
  );
}

export interface ExtractedMessage {
  message: Message;
  chatName: string | null;
  /** The raw envelope, needed to download attached media. */
  info: WAMessage;
}

export function extractMessages(raw: proto.IWebMessageInfo[]): ExtractedMessage[] {
  const out: ExtractedMessage[] = [];
  for (const info of raw) {
    const key = info.key;
    if (!key) continue;
    const chatId = key.remoteJid;
    if (!chatId || chatId === "status@broadcast") continue;
    const imageMessage = info.message?.imageMessage;
    const text = extractText(info.message);
    // Keep picture messages (with or without caption); drop everything else
    // textless — including explicit empty-string texts some clients send.
    if (!text && !imageMessage) continue;
    const fromMe = key.fromMe === true;
    const sender = fromMe ? "me" : (key.participant ?? chatId);
    const ts =
      typeof info.messageTimestamp === "number"
        ? info.messageTimestamp * 1000
        : Number(info.messageTimestamp ?? 0) * 1000 || Date.now();
    out.push({
      message: {
        id: key.id ?? `unknown-${ts}`,
        chatId,
        sender,
        senderName: info.pushName ?? null,
        fromMe,
        text: text ?? "",
        timestamp: ts,
        // url stays null until the download completes (see connection.deliver).
        media: imageMessage
          ? {
              kind: "image",
              url: null,
              width: imageMessage.width ?? null,
              height: imageMessage.height ?? null,
            }
          : null,
      },
      // For 1:1 chats the sender's push name doubles as the chat name.
      chatName: !fromMe && !chatId.endsWith("@g.us") ? (info.pushName ?? null) : null,
      // Safe: entries without a key were skipped above.
      info: info as WAMessage,
    });
  }
  return out;
}
