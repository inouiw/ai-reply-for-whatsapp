import type { Chat, ConnectionStatus, Draft, Message } from "./models";

/** GET /status */
export interface StatusResponse {
  connection: ConnectionStatus;
  /** Present while `connection` is "waiting_qr" — render as a QR code to link the device. */
  qr: string | null;
}

/** GET /chats */
export interface ChatsResponse {
  chats: Chat[];
}

/** GET /chats/:id/messages?limit=50 */
export interface MessagesResponse {
  messages: Message[];
}

/** POST /chats/:id/draft */
export interface CreateDraftRequest {
  prompt: string;
  /** Optional: revise this earlier draft instead of starting fresh. */
  previousDraftId?: number;
}
export interface CreateDraftResponse {
  draft: Draft;
}

/** POST /chats/:id/send */
export interface SendRequest {
  /** Final (possibly edited) text to send. */
  text: string;
  /** Draft that produced this text, marked as sent for bookkeeping. */
  draftId?: number;
}
export interface SendResponse {
  ok: true;
  message: Message;
}

/**
 * POST /transcribe — raw request body containing the audio bytes, with an
 * `audio/*` Content-Type (e.g. `audio/m4a`). Not multipart: Expo's WinterCG
 * fetch cannot send React Native file parts, so the raw body is the contract.
 * The spoken language is auto-detected; no locale needs to be supplied.
 */
export interface TranscribeResponse {
  text: string;
}

/** Events pushed over WS /live while the app is open. */
export type LiveEvent =
  | { type: "message"; message: Message }
  | { type: "connection"; status: ConnectionStatus }
  /** The chat was read on the phone — unanswered badges may have changed. */
  | { type: "read"; chatId: string }
  /** A message's image finished downloading — its media.url is now set. */
  | { type: "media"; chatId: string; messageId: string };
