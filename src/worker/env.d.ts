// Optional settings and secrets that `wrangler types` cannot see in
// wrangler.jsonc. See .env.example for what each one does.
interface Env {
  SESSION_SECRET: string;
  JEV_KEY: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  JEV_MODEL?: string;
  JEV_THRESHOLD?: string;
  JEV_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
}
