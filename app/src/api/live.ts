import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LiveEvent } from "@ai-reply-for-whatsapp/shared";
import { AUTH_HEADERS, WS_URL } from "../config";

// React Native's WebSocket accepts request headers as a third argument; the
// DOM typings in scope only declare the two-argument browser constructor.
const NativeWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: string | string[] | null,
  options: { headers: Record<string, string> },
) => WebSocket;

/**
 * Keeps queries fresh while the app is open: connects to the backend's
 * WebSocket feed and invalidates the affected queries when a message arrives.
 * Reconnects with a small backoff when the connection drops.
 */
export function useLiveFeed(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new NativeWebSocket(WS_URL, null, { headers: AUTH_HEADERS });
      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data)) as LiveEvent;
          if (parsed.type === "message") {
            void queryClient.invalidateQueries({ queryKey: ["chats"] });
            void queryClient.invalidateQueries({ queryKey: ["messages", parsed.message.chatId] });
          } else if (parsed.type === "read") {
            void queryClient.invalidateQueries({ queryKey: ["chats"] });
          } else if (parsed.type === "media") {
            // An image finished downloading — refresh that chat's bubbles
            // (and the list, whose preview may flip to "📷 Photo").
            void queryClient.invalidateQueries({ queryKey: ["messages", parsed.chatId] });
            void queryClient.invalidateQueries({ queryKey: ["chats"] });
          } else if (parsed.type === "connection") {
            void queryClient.invalidateQueries({ queryKey: ["status"] });
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [queryClient]);
}
