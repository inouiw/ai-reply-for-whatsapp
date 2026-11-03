import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Chat, Draft, DraftStatus, Message } from "@ai-reply-for-whatsapp/shared";

const here = dirname(fileURLToPath(import.meta.url));

export class Repo {
  private db: Database.Database;
  private statements = new Map<string, Database.Statement>();

  /** Prepares each distinct SQL string once and reuses it. */
  private stmt(sql: string): Database.Statement {
    const cached = this.statements.get(sql);
    if (cached) return cached;
    const prepared = this.db.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(readFileSync(join(here, "schema.sql"), "utf8"));
    // Migration: `contacts` existed briefly without the tier column.
    const contactCols = this.db.pragma("table_info(contacts)") as { name: string }[];
    if (!contactCols.some((c) => c.name === "from_push")) {
      this.db.exec(`ALTER TABLE contacts ADD COLUMN from_push INTEGER NOT NULL DEFAULT 0`);
    }
    // Migration: read tracking and image attachments arrived later.
    const messageCols = this.db.pragma("table_info(messages)") as { name: string }[];
    const addMessageCol = (name: string, ddl: string) => {
      if (!messageCols.some((c) => c.name === name)) {
        this.db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${ddl}`);
      }
    };
    addMessageCol("read", "INTEGER NOT NULL DEFAULT 0");
    addMessageCol("media_kind", "TEXT");
    addMessageCol("media_path", "TEXT");
    addMessageCol("media_width", "INTEGER");
    addMessageCol("media_height", "INTEGER");
  }

  upsertChat(id: string, name: string | null, isGroup: boolean, lastMessageAt: number): void {
    this
      .stmt(
        `INSERT INTO chats (id, name, is_group, last_message_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = CASE WHEN excluded.name != '' THEN excluded.name ELSE chats.name END,
           last_message_at = MAX(chats.last_message_at, excluded.last_message_at)`,
      )
      .run(id, name ?? "", isGroup ? 1 : 0, lastMessageAt);
  }

  /** True once the chat resolves to a real display name, so lookups aren't repeated. */
  hasChatName(chatId: string): boolean {
    return this.getChatName(chatId) !== chatId;
  }

  /**
   * Records a display name for a JID/LID. An authoritative name (address book,
   * verified name, group subject) overwrites anything; a push name only fills
   * gaps or refreshes an earlier push name — it never replaces an
   * authoritative one, since push names are whatever the contact typed for
   * themselves ("🌸✨") while the user asked for the names they know.
   */
  upsertContact(id: string, name: string | null | undefined, fromPush = false): void {
    const trimmed = name?.trim();
    if (!trimmed) return;
    this
      .stmt(
        `INSERT INTO contacts (id, name, from_push) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           from_push = excluded.from_push
         WHERE excluded.from_push = 0 OR contacts.from_push = 1`,
      )
      .run(id, trimmed, fromPush ? 1 : 0);
  }

  insertMessage(m: Message): void {
    this
      .stmt(
        `INSERT OR IGNORE INTO messages
           (id, chat_id, sender, sender_name, from_me, text, timestamp, read,
            media_kind, media_width, media_height)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.chatId,
        m.sender,
        m.senderName,
        m.fromMe ? 1 : 0,
        m.text,
        m.timestamp,
        // Own messages need no read tracking; mark them read from the start.
        m.fromMe ? 1 : 0,
        m.media?.kind ?? null,
        m.media?.width ?? null,
        m.media?.height ?? null,
      );
  }

  /**
   * Records the downloaded file for a message's media. Called after the
   * (possibly much later) download completes — including on a redelivery
   * whose INSERT was ignored, which is what repairs an earlier failed
   * download. Returns false when the message is unknown (e.g. pruned).
   */
  setMessageMedia(messageId: string, mediaPath: string): boolean {
    const info = this
      .stmt(`UPDATE messages SET media_path = ? WHERE id = ?`)
      .run(mediaPath, messageId);
    return info.changes > 0;
  }

  /**
   * Marks messages as read after the chat was read on the phone.
   * `messageIds` limits it to specific messages (read-self receipts);
   * null marks the whole chat read (app-state "chat read" sync).
   * Returns true when any row actually flipped, so callers can skip
   * broadcasting no-op updates.
   */
  markRead(chatId: string, messageIds: string[] | null): boolean {
    if (messageIds !== null) {
      // Chunked: SQLite caps bound parameters at 32766, and a reconnect can
      // flush a large accumulated receipt batch in one event.
      let changes = 0;
      for (let i = 0; i < messageIds.length; i += 500) {
        const chunk = messageIds.slice(i, i + 500);
        const placeholders = chunk.map(() => "?").join(",");
        changes += this
          .stmt(`UPDATE messages SET read = 1 WHERE chat_id = ? AND read = 0 AND id IN (${placeholders})`)
          .run(chatId, ...chunk).changes;
      }
      return changes > 0;
    }
    const info = this
      .stmt(`UPDATE messages SET read = 1 WHERE chat_id = ? AND read = 0`)
      .run(chatId);
    return info.changes > 0;
  }

  listChats(): Chat[] {
    interface Row {
      id: string;
      name: string;
      is_group: number;
      last_message_at: number;
      last_text: string | null;
      unanswered: number;
    }
    const rows = this
      .stmt(
        `SELECT c.id,
                -- The tiered contact name wins (address book > push name);
                -- chats.name only remains as a fallback for legacy rows.
                COALESCE(ct.name, NULLIF(c.name, ''), '') AS name,
                c.is_group, c.last_message_at,
                (SELECT CASE WHEN m.text = '' AND m.media_kind IS NOT NULL
                             THEN '📷 Photo' ELSE m.text END
                 FROM messages m WHERE m.chat_id = c.id
                 ORDER BY m.timestamp DESC LIMIT 1) AS last_text,
                -- Unanswered AND unread: replying clears it via the timestamp
                -- comparison, reading the chat on the phone via the read flag.
                (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.from_me = 0
                 AND m.read = 0
                 AND m.timestamp > COALESCE(
                   (SELECT MAX(timestamp) FROM messages o WHERE o.chat_id = c.id AND o.from_me = 1), 0
                 )) AS unanswered
         FROM chats c
         LEFT JOIN contacts ct ON ct.id = c.id
         ORDER BY c.last_message_at DESC
         LIMIT 100`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isGroup: r.is_group === 1,
      lastMessageAt: r.last_message_at,
      lastMessageText: r.last_text,
      unansweredCount: r.unanswered,
    }));
  }

  listMessages(chatId: string, limit: number): Message[] {
    interface Row {
      id: string;
      chat_id: string;
      sender: string;
      sender_name: string | null;
      from_me: number;
      text: string;
      timestamp: number;
      media_kind: string | null;
      media_path: string | null;
      media_width: number | null;
      media_height: number | null;
    }
    const rows = this
      .stmt(
        `SELECT * FROM (
           SELECT m.id, m.chat_id, m.sender, m.from_me, m.text, m.timestamp,
                  m.media_kind, m.media_path, m.media_width, m.media_height,
                  -- Current tiered contact name first (address book > push),
                  -- else the push name that came with this message.
                  COALESCE(ct.name, NULLIF(m.sender_name, '')) AS sender_name
           FROM messages m
           LEFT JOIN contacts ct ON ct.id = m.sender
           WHERE m.chat_id = ? ORDER BY m.timestamp DESC LIMIT ?
         ) ORDER BY timestamp ASC`,
      )
      .all(chatId, limit) as Row[];
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      sender: r.sender,
      senderName: r.sender_name,
      fromMe: r.from_me === 1,
      text: r.text,
      timestamp: r.timestamp,
      media: r.media_kind
        ? {
            kind: "image",
            url: r.media_path ? `/media/${r.media_path}` : null,
            width: r.media_width,
            height: r.media_height,
          }
        : null,
    }));
  }

  getChatName(chatId: string): string {
    const row = this
      .stmt(
        `SELECT COALESCE(ct.name, NULLIF(c.name, ''), '') AS name
         FROM chats c LEFT JOIN contacts ct ON ct.id = c.id
         WHERE c.id = ?`,
      )
      .get(chatId) as { name: string } | undefined;
    return row?.name || chatId;
  }

  insertDraft(chatId: string, prompt: string, draft: string): Draft {
    const createdAt = Date.now();
    const result = this
      .stmt(`INSERT INTO drafts (chat_id, prompt, draft, status, created_at) VALUES (?, ?, ?, 'pending', ?)`)
      .run(chatId, prompt, draft, createdAt);
    return { id: Number(result.lastInsertRowid), chatId, prompt, draft, status: "pending", createdAt };
  }

  getDraft(id: number): Draft | null {
    interface Row {
      id: number;
      chat_id: string;
      prompt: string;
      draft: string;
      status: DraftStatus;
      created_at: number;
    }
    const r = this.stmt(`SELECT * FROM drafts WHERE id = ?`).get(id) as Row | undefined;
    if (!r) return null;
    return { id: r.id, chatId: r.chat_id, prompt: r.prompt, draft: r.draft, status: r.status, createdAt: r.created_at };
  }

  setDraftStatus(id: number, status: DraftStatus): void {
    this.stmt(`UPDATE drafts SET status = ? WHERE id = ?`).run(status, id);
  }

  /** Returns the number of pruned messages and their media filenames, so the
   *  caller can delete the image files that just became orphans. */
  pruneOlderThan(cutoffMillis: number): { removed: number; mediaPaths: string[] } {
    const mediaPaths = (
      this
        .stmt(`SELECT media_path FROM messages WHERE timestamp < ? AND media_path IS NOT NULL`)
        .all(cutoffMillis) as { media_path: string }[]
    ).map((r) => r.media_path);
    const info = this.stmt(`DELETE FROM messages WHERE timestamp < ?`).run(cutoffMillis);
    this.stmt(`DELETE FROM drafts WHERE created_at < ?`).run(cutoffMillis);
    // A chat whose messages are all gone would linger in the inbox with no
    // preview, and drafting a reply there fails for lack of history.
    this.stmt(
      `DELETE FROM chats WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = chats.id)`,
    ).run();
    return { removed: info.changes, mediaPaths };
  }
}
