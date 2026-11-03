import type {
  ChatsResponse,
  CreateDraftRequest,
  CreateDraftResponse,
  MessagesResponse,
  SendRequest,
  SendResponse,
  StatusResponse,
  TranscribeResponse,
} from "@ai-reply-for-whatsapp/shared";
import { File } from "expo-file-system";
import { API_BASE_URL, AUTH_HEADERS } from "../config";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers, ...AUTH_HEADERS },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => request<StatusResponse>("/status"),
  chats: () => request<ChatsResponse>("/chats"),
  messages: (chatId: string, limit = 50) =>
    request<MessagesResponse>(`/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`),
  createDraft: (chatId: string, body: CreateDraftRequest) =>
    request<CreateDraftResponse>(`/chats/${encodeURIComponent(chatId)}/draft`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  send: (chatId: string, body: SendRequest) =>
    request<SendResponse>(`/chats/${encodeURIComponent(chatId)}/send`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /**
   * Uploads a recording for transcription. `uri` is a local file URI from
   * expo-audio.
   *
   * Sent as a raw body rather than multipart: Expo SDK 57 replaces global
   * `fetch` with a WinterCG implementation that rejects React Native's legacy
   * `{ uri, name, type }` form parts ("Unsupported FormDataPart implementation"),
   * and RN's and Expo's FormData disagree on `append`'s filename argument.
   * Raw bytes sidestep that entirely.
   */
  transcribe: async (uri: string): Promise<TranscribeResponse> =>
    request<TranscribeResponse>("/transcribe", {
      method: "POST",
      headers: { "Content-Type": "audio/m4a" },
      body: await new File(uri).bytes(),
    }),
};
