import type { FastifyInstance } from "fastify";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { IMAGE_MIME_BY_EXT } from "@ai-reply-for-whatsapp/shared";
import type {
  ChatsResponse,
  CreateDraftResponse,
  MessagesResponse,
  SendResponse,
  StatusResponse,
  TranscribeResponse,
} from "@ai-reply-for-whatsapp/shared";
import type { Repo } from "../db/repo.js";
import type { WhatsApp } from "../whatsapp/connection.js";
import type { ReplyDrafter } from "../llm/draft.js";
import type { Transcriber } from "../llm/transcribe.js";
import type { LiveFeed } from "./ws.js";
import type { Config } from "../config.js";

const DraftBody = z.object({
  prompt: z.string().min(1),
  previousDraftId: z.number().optional(),
});

const MessagesQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(50)
    .transform((n) => Math.min(n, 200)),
});

const SendBody = z.object({
  text: z.string().min(1),
  draftId: z.number().optional(),
});

/** Content-Type subtype → file extension accepted by Whisper-compatible APIs. */
const EXTENSION_BY_SUBTYPE: Record<string, string> = {
  m4a: "m4a",
  "x-m4a": "m4a",
  mp4: "m4a",
  aac: "m4a",
  mpeg: "mp3",
  mp3: "mp3",
  wav: "wav",
  "x-wav": "wav",
  ogg: "ogg",
  opus: "opus",
  webm: "webm",
  flac: "flac",
};

export interface RouteContext {
  repo: Repo;
  whatsapp: WhatsApp;
  drafter: ReplyDrafter;
  /** Null when TRANSCRIBE_API_KEY is unset — /transcribe then reports 503. */
  transcriber: Transcriber | null;
  live: LiveFeed;
  config: Config;
}

export function registerRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { repo, whatsapp, drafter, transcriber, live, config } = ctx;

  app.get("/status", async (): Promise<StatusResponse> => {
    return { connection: whatsapp.status, qr: whatsapp.qr };
  });

  app.get("/chats", async (): Promise<ChatsResponse> => {
    return { chats: repo.listChats() };
  });

  // Images downloaded from WhatsApp, stored under DATA_DIR/media.
  app.get("/media/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    // Filenames are "<sanitized message id>.<ext>"; the anchored shape (no
    // dots in the stem) rules out traversal and directory names like ".".
    const match = /^[A-Za-z0-9_-]+\.([a-z0-9]+)$/.exec(file);
    if (!match) {
      reply.code(404);
      throw new Error("Not found");
    }
    // Opening (rather than stat-then-stream) leaves no window for the prune
    // job to delete the file in between; a miss is a clean 404 either way.
    let handle: FileHandle;
    try {
      handle = await open(join(config.DATA_DIR, "media", file), "r");
    } catch {
      reply.code(404);
      throw new Error("Not found");
    }
    void reply
      .header("Content-Type", IMAGE_MIME_BY_EXT[match[1]!] ?? "application/octet-stream")
      .header("Cache-Control", "private, max-age=31536000, immutable");
    return reply.send(handle.createReadStream());
  });

  app.get("/chats/:id/messages", async (req, reply): Promise<MessagesResponse> => {
    const { id } = req.params as { id: string };
    const query = MessagesQuery.safeParse(req.query);
    if (!query.success) {
      reply.code(400);
      throw new Error(query.error.message);
    }
    return { messages: repo.listMessages(id, query.data.limit) };
  });

  app.post("/chats/:id/draft", async (req, reply): Promise<CreateDraftResponse> => {
    const { id } = req.params as { id: string };
    const parsed = DraftBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      throw new Error(parsed.error.message);
    }
    const body = parsed.data;
    const previous = body.previousDraftId ? repo.getDraft(body.previousDraftId) : null;
    const history = repo.listMessages(id, config.CONTEXT_MESSAGES);
    if (history.length === 0) {
      reply.code(404);
      throw new Error(`No messages known for chat ${id}`);
    }
    const text = await drafter.draft({
      chatName: repo.getChatName(id),
      isGroup: id.endsWith("@g.us"),
      history,
      prompt: body.prompt,
      previousDraft: previous?.draft,
    });
    if (previous) repo.setDraftStatus(previous.id, "discarded");
    return { draft: repo.insertDraft(id, body.prompt, text) };
  });

  app.post("/chats/:id/send", async (req, reply): Promise<SendResponse> => {
    const { id } = req.params as { id: string };
    const parsed = SendBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      throw new Error(parsed.error.message);
    }
    const body = parsed.data;
    const message = await whatsapp.send(id, body.text);
    repo.upsertChat(id, null, id.endsWith("@g.us"), message.timestamp);
    repo.insertMessage(message);
    if (body.draftId) repo.setDraftStatus(body.draftId, "sent");
    live.broadcast({ type: "message", message });
    return { ok: true, message };
  });

  app.post(
    "/transcribe",
    // Audio needs a bigger body cap than the 1 MiB default; scoped to this
    // route so the JSON endpoints can't be fed 25 MB payloads.
    { bodyLimit: config.TRANSCRIBE_MAX_MB * 1024 * 1024 },
    async (req, reply): Promise<TranscribeResponse> => {
      if (!transcriber) {
        reply.code(503);
        throw new Error("Transcription is not configured — set TRANSCRIBE_API_KEY on the server");
      }
      const audio = req.body;
      if (!Buffer.isBuffer(audio) || audio.byteLength === 0) {
        reply.code(400);
        throw new Error("Expected a raw audio body with an audio/* Content-Type");
      }
      // Whisper infers the decoder from the filename extension, so map the
      // Content-Type to an extension the API accepts rather than slicing the
      // subtype blindly ("audio/x-m4a" would otherwise become "recording.x-m4a").
      const subtype = (req.headers["content-type"] ?? "audio/m4a")
        .split("/")[1]
        ?.split(";")[0]
        ?.toLowerCase();
      const extension = (subtype && EXTENSION_BY_SUBTYPE[subtype]) || "m4a";
      const text = await transcriber.transcribe(
        audio,
        `recording.${extension}`,
        `audio/${extension}`,
      );
      return { text };
    },
  );

  app.get("/live", { websocket: true }, (socket) => {
    live.add(socket);
    socket.send(
      JSON.stringify({ type: "connection", status: whatsapp.status } satisfies {
        type: "connection";
        status: typeof whatsapp.status;
      }),
    );
  });
}
