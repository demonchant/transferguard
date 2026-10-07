import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createFieldCipher } from "../lib/crypto.mjs";

test("encrypted fields round trip and use a fresh nonce", () => {
  const cipher = createFieldCipher(randomBytes(32).toString("base64url"));
  const first = cipher.encrypt("supplier says payment has not arrived");
  const second = cipher.encrypt("supplier says payment has not arrived");
  assert.equal(cipher.decrypt(first), "supplier says payment has not arrived");
  assert.notEqual(first, second);
});

test("encrypted fields reject a damaged payload", () => {
  const cipher = createFieldCipher(randomBytes(32).toString("base64url"));
  const value = cipher.encrypt("private evidence");
  assert.throws(() => cipher.decrypt(value.slice(0, -3) + "xyz"));
});
