import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3010),
  /** Localhost only by default; Tailscale Serve proxies to it. 0.0.0.0 opens it to the LAN. */
  HOST: z.string().default("127.0.0.1"),
  /** Bearer token the app must send. Unset: generated once and kept in DATA_DIR/api-token. */
  API_TOKEN: z
    .union([z.literal(""), z.string().min(16, "API_TOKEN must be at least 16 characters")])
    .optional(),
  DATA_DIR: z.string().default("./data"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  /**
   * Speech-to-text. Any OpenAI-compatible /audio/transcriptions endpoint works;
   * the default is Groq's hosted Whisper large-v3-turbo. Leave the key unset to
   * run without voice input — /transcribe then returns 503 and the rest of the
   * server still starts.
   */
  TRANSCRIBE_API_KEY: z.string().optional(),
  TRANSCRIBE_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  TRANSCRIBE_MODEL: z.string().default("whisper-large-v3-turbo"),
  /** Largest audio upload accepted, in megabytes. ~1 MB per minute of AAC. */
  TRANSCRIBE_MAX_MB: z.coerce.number().default(25),
  /** How many recent messages of a chat to give Claude as context. */
  CONTEXT_MESSAGES: z.coerce.number().default(20),
  /** Messages older than this are pruned daily. 0 disables pruning. */
  RETENTION_DAYS: z.coerce.number().default(90),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}
