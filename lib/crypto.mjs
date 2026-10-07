import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function createFieldCipher(encodedKey) {
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.");
  return {
    encrypt(value) {
      if (value === null || value === undefined || value === "") return null;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
    },
    decrypt(value) {
      if (value === null || value === undefined || value === "") return null;
      const [version, ivPart, tagPart, bodyPart] = String(value).split(".");
      if (version !== "v1" || !ivPart || !tagPart || !bodyPart) throw new Error("Encrypted field has an unknown format.");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
      decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(bodyPart, "base64url")), decipher.final()]).toString("utf8");
    },
  };
}
