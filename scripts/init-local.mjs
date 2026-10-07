import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.error(".env already exists. Keep it and edit it directly if needed.");
  process.exit(1);
}

const password = randomBytes(24).toString("base64url");
const sessionSecret = randomBytes(48).toString("base64url");
const encryptionKey = randomBytes(32).toString("base64url");
const content = [
  "APP_HOST=127.0.0.1",
  "APP_PORT=3000",
  "APP_ORIGIN=http://127.0.0.1:3000",
  "DATA_DIR=data",
  "APP_PASSWORD=" + password,
  "APP_SESSION_SECRET=" + sessionSecret,
  "DATA_ENCRYPTION_KEY=" + encryptionKey,
  "AIRWALLEX_CLIENT_ID=",
  "AIRWALLEX_API_KEY=",
  "CLAUDE_API_KEY=",
  "CLAUDE_MODEL=claude-sonnet-4-6",
  "",
].join("\n");
writeFileSync(".env", content, { flag: "wx", mode: 0o600 });
console.log("Created private .env with random local password, session secret, and data-encryption key.");
console.log("Open .env locally to copy APP_PASSWORD for sign-in. Do not share or commit it.");
