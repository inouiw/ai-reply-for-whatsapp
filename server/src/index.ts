import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { Repo } from "./db/repo.js";
import { WhatsApp } from "./whatsapp/connection.js";
import { ReplyDrafter } from "./llm/draft.js";
import { Transcriber } from "./llm/transcribe.js";
import { LiveFeed } from "./http/ws.js";
import { registerRoutes } from "./http/routes.js";
import { loadApiToken, registerAuth } from "./http/auth.js";

const config = loadConfig();
mkdirSync(config.DATA_DIR, { recursive: true });

const repo = new Repo(join(config.DATA_DIR, "app.db"));
const live = new LiveFeed();
const drafter = new ReplyDrafter(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL);
const transcriber = config.TRANSCRIBE_API_KEY
  ? new Transcriber(
      config.TRANSCRIBE_API_KEY,
      config.TRANSCRIBE_BASE_URL,
      config.TRANSCRIBE_MODEL,
    )
  : null;

// Groups whose subject lookup is in flight or recently failed — prevents a
// message burst from firing one groupMetadata() call per message, and an
// unresolvable group from retrying on every single message forever.
const groupSubjectPending = new Set<string>();
const GROUP_SUBJECT_RETRY_MS = 5 * 60 * 1000;

const whatsapp: WhatsApp = new WhatsApp(config.DATA_DIR, {
  onMessage: (message, chatName) => {
    const isGroup = message.chatId.endsWith("@g.us");
    repo.upsertChat(message.chatId, null, isGroup, message.timestamp);
    repo.insertMessage(message);
    // Push names are fallback-tier: they fill gaps and label group senders,
    // but never overwrite an address-book name from contact sync.
    if (!message.fromMe) {
      repo.upsertContact(message.sender, message.senderName, true);
      if (chatName) repo.upsertContact(message.chatId, chatName, true);
    }
    // A group carries no push name, so look its subject up once, lazily.
    if (isGroup && !groupSubjectPending.has(message.chatId) && !repo.hasChatName(message.chatId)) {
      groupSubjectPending.add(message.chatId);
      void whatsapp.fetchGroupSubject(message.chatId).then((subject) => {
        if (subject) {
          repo.upsertContact(message.chatId, subject);
          groupSubjectPending.delete(message.chatId);
        } else {
          // Negative cache — retry at most every few minutes, not per message.
          setTimeout(() => groupSubjectPending.delete(message.chatId), GROUP_SUBJECT_RETRY_MS);
        }
      });
    }
    live.broadcast({ type: "message", message });
  },
  onConnection: (status) => {
    live.broadcast({ type: "connection", status });
  },
  onNames: (names) => {
    for (const { id, name, fromPush } of names) repo.upsertContact(id, name, fromPush);
  },
  // Stored as a name rather than a chat row: `groups.upsert` fires for every
  // group you belong to, and those without messages shouldn't enter the inbox.
  onGroupSubject: (groupId, subject) => {
    repo.upsertContact(groupId, subject);
  },
  // Reading a chat on the phone clears its badge here too.
  onRead: (chatId, messageIds) => {
    if (repo.markRead(chatId, messageIds)) {
      live.broadcast({ type: "read", chatId });
    }
  },
  // Fired when an image download completes — possibly long after the message
  // row was inserted, and also on a redelivery that repairs an earlier
  // failed download.
  onMediaReady: (chatId, messageId, file) => {
    if (repo.setMessageMedia(messageId, file)) {
      live.broadcast({ type: "media", chatId, messageId });
    } else {
      // The message vanished (pruned) before its download finished.
      rmSync(join(config.DATA_DIR, "media", file), { force: true });
    }
  },
});

// The large audio-upload limit is set per-route on /transcribe; everything
// else keeps Fastify's default 1 MiB JSON body cap.
const app = Fastify({ logger: { level: "info" } });
const apiToken = loadApiToken(config.API_TOKEN, config.DATA_DIR);
registerAuth(app, apiToken.token);
if (apiToken.generated) {
  console.log(
    `Generated API token (saved in ${apiToken.file}). Put it in app/.env as EXPO_PUBLIC_API_TOKEN:\n${apiToken.token}`,
  );
}
await app.register(websocket);
// Recordings are uploaded as a raw body, not multipart — see api/client.ts.
app.addContentTypeParser(/^audio\//, { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
registerRoutes(app, { repo, whatsapp, drafter, transcriber, live, config });

if (!transcriber) {
  app.log.warn("TRANSCRIBE_API_KEY is unset — voice input will fail with 503");
}

if (config.RETENTION_DAYS > 0) {
  const prune = () => {
    const cutoff = Date.now() - config.RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const { removed, mediaPaths } = repo.pruneOlderThan(cutoff);
    for (const file of mediaPaths) {
      rmSync(join(config.DATA_DIR, "media", file), { force: true });
    }
    if (removed > 0) app.log.info(`Pruned ${removed} messages older than ${config.RETENTION_DAYS} days`);
  };
  prune();
  setInterval(prune, 24 * 60 * 60 * 1000);
}

await whatsapp.start();
await app.listen({ port: config.PORT, host: config.HOST });
console.log(`API listening on http://${config.HOST}:${config.PORT}`);
