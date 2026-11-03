/** A WhatsApp chat (1:1 or group). `id` is the WhatsApp JID. */
export interface Chat {
  id: string;
  name: string;
  isGroup: boolean;
  lastMessageAt: number;
  lastMessageText: string | null;
  /**
   * Number of incoming messages newer than the last outgoing one that have
   * not been read on the phone. Replying or reading the chat in WhatsApp
   * clears it.
   */
  unansweredCount: number;
}

/** An image attached to a message, downloaded and re-served by the backend. */
export interface MessageMedia {
  /** Discriminator for future media types (video, sticker, …). */
  kind: "image";
  /**
   * Server-relative URL, e.g. "/media/ABC123.jpg" — prefix with the API base.
   * Null while the download is still pending or has failed; a later
   * redelivery or retry can fill it in (announced via a "media" live event).
   */
  url: string | null;
  /** Pixel dimensions when WhatsApp supplied them, for aspect-ratio layout. */
  width: number | null;
  height: number | null;
}

export interface Message {
  id: string;
  chatId: string;
  /** Sender JID; for 1:1 chats this equals the chat id on incoming messages. */
  sender: string;
  /** Display name of the sender, when known. */
  senderName: string | null;
  fromMe: boolean;
  /** Message text or image caption; empty string for a picture-only message. */
  text: string;
  /** Attached image, when the message carried one. */
  media: MessageMedia | null;
  /** Unix millis. */
  timestamp: number;
}

export type DraftStatus = "pending" | "sent" | "discarded";

export interface Draft {
  id: number;
  chatId: string;
  /** The user's spoken/typed instruction of what to reply. */
  prompt: string;
  /** Claude's generated reply text. */
  draft: string;
  status: DraftStatus;
  createdAt: number;
}

/** "replaced": another server took over this WhatsApp session. */
export type ConnectionStatus = "connecting" | "waiting_qr" | "open" | "logged_out" | "replaced";
