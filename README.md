# AI Reply for WhatsApp

Reply to WhatsApp messages by voice from your iPhone: open a chat, speak an
instruction ("tell him I'll be there at 8, but ask if we can move it to
Thursday"), review and edit the reply Claude drafts, then send it.

> **Unofficial.** Not affiliated with WhatsApp or Meta. The server links to
> WhatsApp as a companion device via [Baileys](https://github.com/WhiskeySockets/Baileys),
> which WhatsApp's Terms of Service do not allow. Only messages you approve are
> sent, but your account could still be banned. Use at your own risk.

## How it works

```
WhatsApp ──▶ server/   Node (Fastify + Baileys), stores chats in SQLite,
                │      drafts replies with Claude, transcribes voice with Whisper
                │      REST + WebSocket API on port 3010
                ▼
             app/      Expo React Native app (iPhone)
```

- `server/`: backend, runs on your laptop or a separate server (e.g. Raspberry Pi)
- `app/`: iPhone app
- `packages/shared/`: TypeScript types shared by both

## Requirements

- **iPhone only.** There is no Android or web app.
- **A Mac with Xcode** to build and install the app.
- **An Apple Developer Program account** ($99/year). A free Apple ID also works, but the app then stops launching after 7 days and must be reinstalled.
- Node.js 22.9 or newer, on the Mac and on the server.
- [Anthropic API key](https://console.anthropic.com/) for drafting replies.
- [Groq API key](https://console.groq.com/keys) for speech-to-text (free tier is enough).
- [Tailscale](https://tailscale.com/) on the server and the iPhone, so the app can reach the server from anywhere.

## 1. Server

Run it on your own laptop or on a separate always-on machine such as a Raspberry Pi
(64-bit OS) or home server. **The server must be online for messages to reach your
phone.** Messages that arrive while it is off show up once it is running again.

```bash
git clone https://github.com/inouiw/ai-reply-for-whatsapp.git
cd ai-reply-for-whatsapp
npm install
cp server/.env.example server/.env   # set ANTHROPIC_API_KEY, uncomment and set TRANSCRIBE_API_KEY
npm run server
```

Scan the QR code printed in the terminal: WhatsApp → **Settings → Linked devices → Link a device**.
The session is saved in `server/data/auth/`. Back up `server/data/`; it also holds your messages.

The first start also prints an **API token** (saved in `server/data/api-token`). The app
needs it; every request without it is rejected.

Keep it running with systemd (Linux), as `/etc/systemd/system/ai-reply-for-whatsapp.service`:

```ini
[Unit]
Description=AI Reply for WhatsApp backend
After=network-online.target

[Service]
WorkingDirectory=/home/<user>/ai-reply-for-whatsapp/server
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
User=<user>

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now ai-reply-for-whatsapp
journalctl -u ai-reply-for-whatsapp -f   # logs, including the QR code
```

Serve it over HTTPS on your tailnet (iOS blocks plain HTTP to host names). First enable
**MagicDNS** and **HTTPS Certificates** in the [Tailscale admin console](https://login.tailscale.com/admin/dns), then:

```bash
sudo tailscale serve --bg 3010   # → https://<server>.<tailnet>.ts.net
```

By default the server only listens on `127.0.0.1`, so it is reachable through Tailscale
Serve and nothing else. Never expose it to the internet; the API token is the only lock
on your WhatsApp account.

## 2. iPhone app

On the Mac, with the iPhone connected by cable and
[Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device) enabled:

```bash
git clone https://github.com/inouiw/ai-reply-for-whatsapp.git
cd ai-reply-for-whatsapp
npm install
```

Set your own bundle ID in `app/app.json` (`ios.bundleIdentifier`, e.g. `com.yourname.aireply`), then:

```bash
cat > app/.env <<EOF
EXPO_PUBLIC_API_URL=https://<server>.<tailnet>.ts.net
EXPO_PUBLIC_API_TOKEN=<token from server/data/api-token>
EOF
cd app
npx expo prebuild --platform ios --clean
npx expo run:ios --device --configuration Release   # pick your Apple team when asked
```

The server URL and token are built into the app. After changing `app/.env`, run the last command again.

## Development

Run the server locally and the app with hot reload:

```bash
echo "HOST=0.0.0.0" >> server/.env                   # reachable from the iPhone over the LAN
npm run server                                       # API on http://<mac-lan-ip>:3010
cat > app/.env <<EOF
EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:3010
EXPO_PUBLIC_API_TOKEN=$(cat server/data/api-token)
EOF
cd app && npx expo run:ios --device                  # once: installs the debug build
cd .. && npm run app                                 # afterwards: start Metro only
npm run typecheck                                    # all workspaces
```

After changing `app/.env`, restart Metro with `npx expo start --clear`.

## Configuration (`server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | Claude API key for drafting replies |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Model used for drafts |
| `TRANSCRIBE_API_KEY` | unset (voice input off) | Key for the speech-to-text API |
| `TRANSCRIBE_BASE_URL` | `https://api.groq.com/openai/v1` | Any OpenAI-compatible `/audio/transcriptions` endpoint |
| `TRANSCRIBE_MODEL` | `whisper-large-v3-turbo` | Speech-to-text model; detects the spoken language |
| `TRANSCRIBE_MAX_MB` | `25` | Largest accepted recording |
| `PORT` | `3010` | API port |
| `API_TOKEN` | generated into `DATA_DIR/api-token` | Token the app must send (at least 16 characters) |
| `HOST` | `127.0.0.1` | Interface to listen on; `0.0.0.0` opens it to the LAN |
| `DATA_DIR` | `./data` | WhatsApp session, database and media |
| `CONTEXT_MESSAGES` | `20` | Recent messages given to Claude per draft |
| `RETENTION_DAYS` | `90` | Delete messages older than this (`0` keeps everything) |

## Notes

- Recordings are sent to the transcription API (Groq by default); messages and your instructions are sent to the Anthropic API.
- Messages that arrive while the server is offline are delivered when it reconnects. After about 14 days offline, or if your phone doesn't open WhatsApp for about 14 days, WhatsApp unlinks the server and you have to scan the QR code again.

---

Created by David Neuy and
[contributors](https://github.com/inouiw/ai-reply-for-whatsapp/graphs/contributors).

## License

Released under the [MIT License](LICENSE).
