import { loadEnvFile } from "./env.mjs";

loadEnvFile();

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export const config = Object.freeze({
  appMode: "sandbox",
  appHost: process.env.APP_HOST || "127.0.0.1",
  appPort: integer(process.env.APP_PORT, 3000, 1, 65535),
  appOrigin: process.env.APP_ORIGIN || "http://127.0.0.1:3000",
  appPassword: process.env.APP_PASSWORD || "",
  sessionSecret: process.env.APP_SESSION_SECRET || "",
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || "",
  airwallexMode: "sandbox",
  airwallexClientId: process.env.AIRWALLEX_CLIENT_ID || "",
  airwallexApiKey: process.env.AIRWALLEX_API_KEY || "",
  claudeApiKey: process.env.CLAUDE_API_KEY || "",
  claudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-6",
  dataDir: process.env.DATA_DIR || "data",
});

export function validateConfig() {
  if (config.appPassword.length < 16) {
    throw new Error("APP_PASSWORD must be at least 16 characters. Run npm run init-local.");
  }
  if (config.sessionSecret.length < 32) {
    throw new Error("APP_SESSION_SECRET must be at least 32 characters. Run npm run init-local.");
  }
  if (Buffer.from(config.dataEncryptionKey, "base64url").length !== 32) {
    throw new Error("DATA_ENCRYPTION_KEY must be a base64url-encoded 32-byte key. Run npm run init-local.");
  }
  if (!config.claudeApiKey.trim()) {
    throw new Error("CLAUDE_API_KEY is required for evidence review. Add it to the private .env file.");
  }
  let origin;
  try {
    origin = new URL(config.appOrigin);
  } catch {
    throw new Error("APP_ORIGIN must be a valid origin URL.");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("APP_ORIGIN must contain only scheme, host, and optional port.");
  }
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use HTTPS in production.");
  }
}
