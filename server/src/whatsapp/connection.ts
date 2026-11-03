import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  areJidsSameUser,
  jidNormalizedUser,
  DisconnectReason,
  proto,
  type Contact,
  type WAMessage,
  type WASocket,
} from "baileys";
import { Boom } from "@hapi/boom";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { IMAGE_EXT_BY_MIME, type ConnectionStatus, type Message } from "@ai-reply-for-whatsapp/shared";
import { extractMessages, type ExtractedMessage } from "./handlers.js";

export interface NameEntry {
  id: string;
  name: string;
  /** True when the name is the contact's self-chosen push name (lowest tier). */
  fromPush: boolean;
}

export interface WhatsAppEvents {
  onMessage: (message: Message, chatName: string | null) => void;
  onConnection: (status: ConnectionStatus, qr: string | null) => void;
  /** Display names learned from contact/history sync, keyed by JID or LID. */
  onNames: (names: NameEntry[]) => void;
  /** A group's subject, which is that chat's display name. */
  onGroupSubject: (groupId: string, subject: string) => void;
  /**
   * The chat was read on the phone. `messageIds` names the messages when the
   * signal was a per-message read receipt; null means the whole chat.
   */
  onRead: (chatId: string, messageIds: string[] | null) => void;
  /** A message's image finished downloading; `file` is the name under DATA_DIR/media. */
  onMediaReady: (chatId: string, messageId: string, file: string) => void;
}

/**
 * WhatsApp exposes several name fields of differing quality: `name` is what the
 * user saved in their own address book and `verifiedName` is a business's
 * verified name (both authoritative), while `notify` is the push name the
 * contact chose for themselves (fallback only — it must not shadow the others).
 *
 * A contact may also be delivered keyed by phone number while its chat is
 * addressed by LID (or vice versa), so record the name under every identifier
 * it carries.
 */
function nameEntries(contacts: Partial<Contact>[]): NameEntry[] {
  const out: NameEntry[] = [];
  for (const c of contacts) {
    const authoritative = c.name?.trim() || c.verifiedName?.trim();
    const name = authoritative || c.notify?.trim();
    if (!name) continue;
    for (const id of [c.id, c.lid, c.phoneNumber]) {
      if (id) out.push({ id, name, fromPush: !authoritative });
    }
  }
  return out;
}

const logger = pino({ level: "warn" });

/** Kill a stalled download; a re-upload round-trip via the phone can otherwise pend forever. */
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export class WhatsApp {
  private sock: WASocket | null = null;
  private mediaDir: string;
  /**
   * Serializes image downloads: one at a time, so a reconnect burst of image
   * messages cannot fan out into unbounded parallel CDN fetches, each
   * buffering a whole image in memory. The chain never rejects (every link
   * catches), so one failed download cannot poison the queue.
   */
  private downloadChain: Promise<void> = Promise.resolve();
  /** Consecutive failed connection attempts; drives the reconnect backoff. */
  private reconnectAttempts = 0;
  status: ConnectionStatus = "connecting";
  qr: string | null = null;

  constructor(
    private dataDir: string,
    private events: WhatsAppEvents,
  ) {
    this.mediaDir = join(dataDir, "media");
    mkdirSync(this.mediaDir, { recursive: true });
  }

  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(join(this.dataDir, "auth"));
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      // We approve every reply manually, so no automated read receipts.
      markOnlineOnConnect: false,
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.status = "waiting_qr";
        this.qr = qr;
        this.events.onConnection(this.status, qr);
        console.log("Scan this QR with WhatsApp (Linked devices > Link a device):");
        void import("qrcode-terminal").then((qrt) => qrt.default.generate(qr, { small: true }));
      }
      if (connection === "open") {
        this.reconnectAttempts = 0;
        this.status = "open";
        this.qr = null;
        this.events.onConnection(this.status, null);
        console.log("WhatsApp connection established.");
      }
      if (connection === "close") {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          this.status = "logged_out";
          this.events.onConnection(this.status, null);
          console.error(
            `Logged out by WhatsApp. Delete ${join(this.dataDir, "auth")} and restart to re-link.`,
          );
        } else if (code === DisconnectReason.connectionReplaced) {
          // Reconnecting would kick the other instance off, which then kicks
          // this one off again, forever.
          this.status = "replaced";
          this.events.onConnection(this.status, null);
          console.error(
            "Another server is using this WhatsApp session. Stop it, then restart this one.",
          );
        } else {
          this.status = "connecting";
          this.events.onConnection(this.status, null);
          console.log(`Connection closed (code ${code ?? "unknown"}), reconnecting...`);
          this.scheduleReconnect();
        }
      }
    });

    sock.ev.on("contacts.upsert", (contacts) => {
      this.events.onNames(nameEntries(contacts));
    });
    sock.ev.on("contacts.update", (updates) => {
      this.events.onNames(nameEntries(updates));
    });

    // Bulk sync delivered after linking, and the main source of names for
    // chats you started yourself (which carry no incoming push name).
    sock.ev.on("messaging-history.set", ({ contacts, chats }) => {
      this.events.onNames(nameEntries(contacts));
      for (const chat of chats) {
        const name = chat.name?.trim();
        const id = chat.id;
        if (id && name) this.events.onNames([{ id, name, fromPush: false }]);
      }
    });

    const onGroups = (groups: { id?: string | null; subject?: string | null }[]) => {
      for (const g of groups) {
        if (g.id && g.subject?.trim()) this.events.onGroupSubject(g.id, g.subject.trim());
      }
    };
    sock.ev.on("groups.upsert", onGroups);
    sock.ev.on("groups.update", onGroups);

    sock.ev.on("messages.upsert", ({ messages }) => {
      for (const extracted of extractMessages(messages)) {
        this.deliver(extracted);
      }
    });

    // Reading a chat on the phone reaches the companion on three paths:
    // per-message "read-self" receipts (messages.update with a READ status in
    // 1:1 chats, message-receipt.update in groups) and the app-state "chat
    // read" sync (chats.update with unreadCount 0). Handle all of them —
    // receipts are precise but per-message, the app-state sync also covers
    // reads that happened while this server was down.
    sock.ev.on("messages.update", (updates) => {
      const idsByChat = new Map<string, string[]>();
      for (const { key, update } of updates) {
        const status = update.status;
        if (status == null || status < proto.WebMessageInfo.Status.READ) continue;
        if (!key.remoteJid || !key.id) continue;
        const ids = idsByChat.get(key.remoteJid) ?? [];
        ids.push(key.id);
        idsByChat.set(key.remoteJid, ids);
      }
      for (const [chatId, ids] of idsByChat) this.emitRead(chatId, ids);
    });

    // In group chats the phone's "read-self" receipt is emitted per
    // participant as message-receipt.update, not messages.update. A read
    // receipt whose reader is this account means the chat was read on the phone.
    sock.ev.on("message-receipt.update", (updates) => {
      const idsByChat = new Map<string, string[]>();
      for (const { key, receipt } of updates) {
        const reader = receipt.userJid ?? undefined;
        if (!receipt.readTimestamp || !reader || !key.remoteJid || !key.id) continue;
        const me = sock.user;
        const isSelf =
          areJidsSameUser(reader, me?.id ?? undefined) ||
          areJidsSameUser(reader, me?.lid ?? undefined);
        if (!isSelf) continue;
        const ids = idsByChat.get(key.remoteJid) ?? [];
        ids.push(key.id);
        idsByChat.set(key.remoteJid, ids);
      }
      for (const [chatId, ids] of idsByChat) this.emitRead(chatId, ids);
    });

    sock.ev.on("chats.update", (updates) => {
      for (const update of updates) {
        // Known limitation: Baileys drops markChatAsReadAction.messageRange,
        // so this clear cannot be bounded to the messages the phone actually
        // read. In the rare replay where a stale read marker is processed
        // after newer offline messages were inserted, those get marked read
        // too. Bounding it would also suppress the common case (badge
        // clearing after a server restart), so the unbounded clear stays.
        if (update.id && update.unreadCount === 0) this.emitRead(update.id, null);
      }
    });
  }

  /** Exponential backoff (1 s doubling up to a minute), retrying failed starts too. */
  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts += 1;
    setTimeout(() => {
      this.start().catch((error: unknown) => {
        logger.error({ err: error }, "reconnect failed");
        this.scheduleReconnect();
      });
    }, delay);
  }

  /**
   * A 1:1 chat is addressed by two interchangeable JIDs — the phone-number
   * form and the privacy LID — and a read signal often arrives under the
   * opposite form from the one the messages were stored under (receipts and
   * the app-state "chat read" sync are typically PN-addressed, while Baileys 7
   * delivers messages LID-addressed). Resolve the alternate identity and emit
   * the read under both, so it lands on the stored rows either way.
   */
  private emitRead(rawChatId: string, messageIds: string[] | null): void {
    // Receipts may carry a device-suffixed JID; chats are stored bare.
    const chatId = jidNormalizedUser(rawChatId) || rawChatId;
    this.events.onRead(chatId, messageIds);
    const mapping = this.sock?.signalRepository.lidMapping;
    if (!mapping) return;
    const alt = chatId.endsWith("@lid")
      ? mapping.getPNForLID(chatId)
      : chatId.endsWith("@s.whatsapp.net")
        ? mapping.getLIDForPN(chatId)
        : null;
    if (!alt) return;
    alt.then(
      (altId) => {
        // Normalized: the mapping can return a device-suffixed JID
        // ("…:0@s.whatsapp.net"), but chats are stored under the bare form.
        if (altId) this.events.onRead(jidNormalizedUser(altId), messageIds);
      },
      () => {
        // No stored mapping (or lookup failed) — the direct form was already tried.
      },
    );
  }

  /**
   * Stores and broadcasts the message immediately — before any media I/O —
   * so read receipts arriving moments later find the row, and batch order is
   * preserved. The image (if any) downloads afterwards on a serial queue and
   * is attached via onMediaReady.
   */
  private deliver({ message, chatName, info }: ExtractedMessage): void {
    try {
      this.events.onMessage(message, chatName);
    } catch (error) {
      // A transient store failure must not bubble into Baileys' emitter
      // (or, previously, an unhandled rejection) and take the server down.
      logger.error({ err: error, messageId: message.id }, "failed to store incoming message");
      return;
    }
    if (message.media?.kind === "image") {
      this.downloadChain = this.downloadChain
        .then(() => this.downloadImage(info, message))
        .catch((error: unknown) => {
          logger.warn({ err: error, messageId: message.id }, "image download failed");
        });
    }
  }

  private async downloadImage(info: WAMessage, message: Message): Promise<void> {
    const buffer = await withTimeout(
      downloadMediaMessage(
        info,
        "buffer",
        {},
        {
          logger,
          // Lets WhatsApp re-upload media whose original CDN copy expired.
          reuploadRequest: this.sock!.updateMediaMessage,
        },
      ),
      DOWNLOAD_TIMEOUT_MS,
      `download of ${message.id}`,
    );
    const mimetype = info.message?.imageMessage?.mimetype ?? "";
    const extension = IMAGE_EXT_BY_MIME[mimetype] ?? "jpg";
    const file = `${message.id.replace(/[^A-Za-z0-9_-]/g, "")}.${extension}`;
    await writeFile(join(this.mediaDir, file), buffer);
    this.events.onMediaReady(message.chatId, message.id, file);
  }

  /**
   * Asks WhatsApp for a group's subject. Groups have no push name, so this is
   * the only way to name one that predates this server's history sync.
   */
  async fetchGroupSubject(groupId: string): Promise<string | null> {
    if (!this.sock || this.status !== "open") return null;
    try {
      const metadata = await this.sock.groupMetadata(groupId);
      return metadata.subject?.trim() || null;
    } catch {
      return null;
    }
  }

  async send(chatId: string, text: string): Promise<Message> {
    if (!this.sock || this.status !== "open") {
      throw new Error("WhatsApp is not connected");
    }
    const result = await this.sock.sendMessage(chatId, { text });
    return {
      id: result?.key.id ?? `local-${Date.now()}`,
      chatId,
      sender: "me",
      senderName: null,
      fromMe: true,
      text,
      timestamp: Date.now(),
      media: null,
    };
  }
}
