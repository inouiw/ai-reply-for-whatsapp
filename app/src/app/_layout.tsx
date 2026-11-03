import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useLiveFeed } from "../api/live";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 1 },
  },
});

function LiveFeedBridge() {
  useLiveFeed();
  return null;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveFeedBridge />
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#1f2c34" },
          headerTintColor: "#e9edef",
          contentStyle: { backgroundColor: "#0b141a" },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Chats" }} />
        <Stack.Screen name="chat/[id]" options={{ title: "" }} />
      </Stack>
    </QueryClientProvider>
  );
}
