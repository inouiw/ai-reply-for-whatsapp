CREATE TABLE IF NOT EXISTS chats (
  id              TEXT PRIMARY KEY,     -- WhatsApp JID, e.g. '4917...@s.whatsapp.net'
  name            TEXT NOT NULL DEFAULT '',
  is_group        INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER NOT NULL DEFAULT 0
);

-- Display names keyed by JID/LID, learned from WhatsApp's contact and history
-- sync. Kept separate from `chats` because a name is also needed for group
-- participants, who are senders but never chats of their own.
-- `from_push` tiers the sources: 0 = authoritative (address-book name,
-- verified business name, group subject), 1 = the sender's self-chosen push
-- name. Push names must never overwrite an authoritative name.
CREATE TABLE IF NOT EXISTS contacts (
  id        TEXT PRIMARY KEY,  -- JID or LID, e.g. '123456789012345@lid'
  name      TEXT NOT NULL,
  from_push INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,         -- WhatsApp message ID
  chat_id     TEXT NOT NULL REFERENCES chats(id),
  sender      TEXT NOT NULL,
  sender_name TEXT,
  from_me     INTEGER NOT NULL DEFAULT 0,
  text        TEXT NOT NULL,             -- '' for picture-only messages
  timestamp   INTEGER NOT NULL,          -- unix millis
  read        INTEGER NOT NULL DEFAULT 0, -- read on the phone (incoming only)
  media_kind  TEXT,                      -- 'image'; set at insert time
  media_path  TEXT,                      -- filename under DATA_DIR/media, set once downloaded
  media_width  INTEGER,
  media_height INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_id, timestamp);

CREATE TABLE IF NOT EXISTS drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  draft      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | discarded
  created_at INTEGER NOT NULL
);
