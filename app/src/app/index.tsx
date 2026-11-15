import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { Chat } from "@ai-reply-for-whatsapp/shared";
import { useChats, useStatus } from "../api/queries";

function ConnectionBanner() {
  const { data } = useStatus();
  if (!data || data.connection === "open") return null;
  const label =
    data.connection === "waiting_qr"
      ? "Not linked — scan the QR code shown in the server logs"
      : data.connection === "logged_out"
        ? "Logged out — re-link the server to WhatsApp"
        : data.connection === "replaced"
          ? "Another server took over this WhatsApp session — stop it and restart this one"
          : "Connecting to WhatsApp…";
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{label}</Text>
    </View>
  );
}

function ChatRow({ chat, onPress }: { chat: Chat; onPress: () => void }) {
  const time = chat.lastMessageAt
    ? new Date(chat.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {chat.name || chat.id.split("@")[0]}
          </Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={styles.preview} numberOfLines={1}>
            {chat.lastMessageText ?? ""}
          </Text>
          {chat.unansweredCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{chat.unansweredCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function InboxScreen() {
  const router = useRouter();
  const { data, isLoading, refetch, error } = useChats();
  // Spinner state for the pull gesture only. Binding the RefreshControl to
  // isRefetching would flash it on every 15s background poll, nudging all
  // rows down and up although nothing changed.
  const [pulling, setPulling] = useState(false);

  return (
    <View style={styles.container}>
      <ConnectionBanner />
      {error ? (
        <View style={styles.center}>
          <Text style={styles.error}>Cannot reach the backend.{"\n"}{String(error)}</Text>
        </View>
      ) : (
        <FlatList
          data={data?.chats ?? []}
          keyExtractor={(chat) => chat.id}
          renderItem={({ item }) => (
            <ChatRow
              chat={item}
              onPress={() =>
                router.push({
                  pathname: "/chat/[id]",
                  params: { id: item.id, name: item.name || item.id.split("@")[0] },
                })
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                void refetch().finally(() => setPulling(false));
              }}
            />
          }
          ListEmptyComponent={
            isLoading ? undefined : (
              <View style={styles.center}>
                <Text style={styles.empty}>
                  No messages yet.{"\n"}New WhatsApp messages will appear here.
                </Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b141a" },
  banner: { backgroundColor: "#182229", padding: 10 },
  bannerText: { color: "#ffd279", textAlign: "center", fontSize: 13 },
  row: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 12 },
  rowBody: { flex: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#222d34", paddingBottom: 10 },
  rowTop: { flexDirection: "row", justifyContent: "space-between" },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  name: { color: "#e9edef", fontSize: 16, fontWeight: "500", flex: 1, marginRight: 8 },
  time: { color: "#8696a0", fontSize: 12 },
  preview: { color: "#8696a0", fontSize: 14, flex: 1, marginRight: 8 },
  badge: {
    backgroundColor: "#00a884",
    borderRadius: 11,
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { color: "#0b141a", fontSize: 12, fontWeight: "700" },
  center: { padding: 40, alignItems: "center" },
  empty: { color: "#8696a0", textAlign: "center", lineHeight: 22 },
  error: { color: "#f28b82", textAlign: "center", lineHeight: 22 },
});
