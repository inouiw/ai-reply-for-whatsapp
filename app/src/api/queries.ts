import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateDraftRequest, SendRequest } from "@ai-reply-for-whatsapp/shared";
import { api } from "./client";

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: api.status,
    refetchInterval: 5000,
  });
}

export function useChats() {
  return useQuery({
    queryKey: ["chats"],
    queryFn: api.chats,
    refetchInterval: 15000,
  });
}

export function useMessages(chatId: string) {
  return useQuery({
    queryKey: ["messages", chatId],
    queryFn: () => api.messages(chatId),
    enabled: chatId.length > 0,
  });
}

export function useCreateDraft(chatId: string) {
  return useMutation({
    mutationFn: (body: CreateDraftRequest) => api.createDraft(chatId, body),
  });
}

export function useSend(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendRequest) => api.send(chatId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["messages", chatId] });
      void queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}
