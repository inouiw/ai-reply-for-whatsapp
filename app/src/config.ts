// Where the backend lives: your Mac's LAN IP during development, the server's
// Tailscale address in production.
// Override without code changes: EXPO_PUBLIC_API_URL=http://100.x.y.z:3010 npx expo start
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3010";

export const WS_URL = API_BASE_URL.replace(/^http/, "ws") + "/live";

// Must match the server's API_TOKEN (or the token it generated in data/api-token).
const API_TOKEN = process.env.EXPO_PUBLIC_API_TOKEN ?? "";

/** Sent with every request to the backend: fetch, the WebSocket and images. */
export const AUTH_HEADERS: Record<string, string> = { Authorization: `Bearer ${API_TOKEN}` };

// Speech-to-text runs on the backend (POST /transcribe) rather than on-device,
// so the spoken language is auto-detected and there is no locale to configure.
