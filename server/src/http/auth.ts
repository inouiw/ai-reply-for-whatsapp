import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MIN_TOKEN_LENGTH = 16;

export interface ApiToken {
  token: string;
  /** True when the token was generated on this start and must be shown once. */
  generated: boolean;
  /** Where a generated token is kept; null when it comes from API_TOKEN. */
  file: string | null;
}

/**
 * The token from API_TOKEN, else the one saved in DATA_DIR/api-token, else a
 * freshly generated one saved there — so a server never runs without one.
 */
export function loadApiToken(fromEnv: string | undefined, dataDir: string): ApiToken {
  if (fromEnv) return { token: fromEnv, generated: false, file: null };
  const file = join(dataDir, "api-token");
  const saved = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  // An empty file would make "Bearer " the password — exactly what an app
  // built without EXPO_PUBLIC_API_TOKEN sends — so it counts as missing.
  if (saved.length >= MIN_TOKEN_LENGTH) return { token: saved, generated: false, file };
  const token = randomBytes(32).toString("base64url");
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return { token, generated: true, file };
}

// Hashing first gives equal-length buffers, which timingSafeEqual requires.
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Rejects every request, the /live WebSocket upgrade included, without `Authorization: Bearer <token>`. */
export function registerAuth(app: FastifyInstance, token: string): void {
  const expected = digest(`Bearer ${token}`);
  app.addHook("onRequest", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    if (!timingSafeEqual(digest(header), expected)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
