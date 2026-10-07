import { createHmac, scryptSync, timingSafeEqual, randomBytes } from "node:crypto";

const SESSION_SECONDS = 8 * 60 * 60;
const passwordSalt = Buffer.from("transferguard login v1");

function b64(value) {
  return Buffer.from(value).toString("base64url");
}

function equal(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSecurity({ password, secret, production }) {
  const expectedPasswordHash = scryptSync(password, passwordSalt, 32);
  function signature(payload) {
    return createHmac("sha256", secret).update(payload).digest("base64url");
  }
  return {
    verifyPassword(candidate) {
      const actual = scryptSync(String(candidate || ""), passwordSalt, 32);
      return timingSafeEqual(actual, expectedPasswordHash);
    },
    createSession() {
      const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, nonce: randomBytes(16).toString("base64url") });
      const encoded = b64(payload);
      return encoded + "." + signature(encoded);
    },
    isValidSession(value) {
      if (typeof value !== "string") return false;
      const parts = value.split(".");
      if (parts.length !== 2 || !equal(parts[1], signature(parts[0]))) return false;
      try {
        const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
        return Number.isInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
      } catch {
        return false;
      }
    },
    cookie(value, maxAge = SESSION_SECONDS) {
      return "tg_session=" + value + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge +
        (production ? "; Secure" : "");
    },
  };
}

export function readSessionCookie(header = "") {
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "tg_session") return rest.join("=");
  }
  return "";
}
