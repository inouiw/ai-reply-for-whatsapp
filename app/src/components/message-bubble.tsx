import { Image, StyleSheet, Text, View } from "react-native";
import type { Message } from "@ai-reply-for-whatsapp/shared";
import { API_BASE_URL, AUTH_HEADERS } from "../config";

// Bubbles max out at 82% of the screen; a fixed image width keeps rows stable.
const IMAGE_WIDTH = 240;

export function MessageBubble({ message, isGroup }: { message: Message; isGroup: boolean }) {
  const mine = message.fromMe;
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Like WhatsApp: sender names label incoming messages in groups only.
  const senderLabel = !mine && isGroup ? (message.senderName ?? message.sender.split("@")[0]) : null;
  const media = message.media;
  const aspectRatio = media?.width && media.height ? media.width / media.height : 4 / 3;
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {senderLabel ? <Text style={styles.sender}>{senderLabel}</Text> : null}
        {media?.url ? (
          <Image
            source={{ uri: `${API_BASE_URL}${media.url}`, headers: AUTH_HEADERS }}
            style={[styles.image, { aspectRatio }]}
            resizeMode="cover"
          />
        ) : media ? (
          // Image still downloading on the server (or the download failed) —
          // a "media" live event swaps this for the real picture.
          <View style={[styles.image, styles.imagePending, { aspectRatio }]}>
            <Text style={styles.imagePendingIcon}>📷</Text>
          </View>
        ) : null}
        {message.text ? <Text style={styles.text}>{message.text}</Text> : null}
        <Text style={styles.time}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", marginVertical: 2, paddingHorizontal: 10 },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  bubbleMine: { backgroundColor: "#005c4b" },
  bubbleTheirs: { backgroundColor: "#202c33" },
  sender: { color: "#53bdeb", fontSize: 12, fontWeight: "600", marginBottom: 2 },
  image: { width: IMAGE_WIDTH, maxWidth: "100%", borderRadius: 8, marginVertical: 2 },
  imagePending: { backgroundColor: "#101a20", alignItems: "center", justifyContent: "center" },
  imagePendingIcon: { fontSize: 32, opacity: 0.5 },
  text: { color: "#e9edef", fontSize: 15 },
  time: { color: "#8696a0", fontSize: 10, alignSelf: "flex-end", marginTop: 2 },
});
