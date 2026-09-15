import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

dotenv.config({ path: path.join(root, ".env") });

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const ROOT = root;
export const PUBLIC_DIR = path.resolve(root, "..", "public");

const list = v => String(v || "").split(",").map(x => x.trim().replace(/\/+$/, "")).filter(Boolean);

export const config = {
  port: num(process.env.PORT, 4000),
  publicUrl: (process.env.PUBLIC_URL || "http://localhost:" + num(process.env.PORT, 4000)).replace(/\/+$/, ""),
  jwtSecret: process.env.JWT_SECRET || "orbita-desarrollo-inseguro",
  encryptionKey: process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "orbita-desarrollo-inseguro",
  dbFile: path.resolve(root, process.env.DB_FILE || "./data/orbita.db"),
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),
  cookieName: process.env.COOKIE_NAME || "orbita_sesion",
  cookieSecure: String(process.env.COOKIE_SECURE || "") === "1" || (process.env.PUBLIC_URL || "").startsWith("https://"),
  trustProxy: String(process.env.TRUST_PROXY || "") === "1",
  ms: {
    clientId: process.env.MS_CLIENT_ID || "",
    clientSecret: process.env.MS_CLIENT_SECRET || "",
    tenant: process.env.MS_TENANT || "common",
    redirectUri: process.env.MS_REDIRECT_URI || "",
    scopes: process.env.MS_SCOPES || "offline_access User.Read Mail.Read"
  },
  llm: {
    provider: (process.env.LLM_PROVIDER || "anthropic").toLowerCase(),
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "claude-sonnet-4-5",
    baseUrl: process.env.LLM_BASE_URL || "",
    jsonMode: String(process.env.LLM_JSON_MODE || "1") === "1"
  },
  sync: {
    intervalMinutes: num(process.env.SYNC_INTERVAL_MINUTES, 10),
    lookbackHours: num(process.env.SYNC_LOOKBACK_HOURS, 72),
    batch: num(process.env.MAIL_BATCH, 25)
  }
};

export const msReady = () => !!(config.ms.clientId && config.ms.clientSecret && config.ms.redirectUri);
export const llmReady = () => !!config.llm.apiKey;
