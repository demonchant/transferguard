import test from "node:test";
import assert from "node:assert/strict";
import { createSecurity } from "../lib/security.mjs";

test("workspace sessions are signed, expiring tokens", () => {
  const security = createSecurity({ password: "test-only-long-password", secret: "test-only-session-secret-long-enough-to-sign", production: false });
  const token = security.createSession();
  assert.equal(security.isValidSession(token), true);
  assert.equal(security.isValidSession(token + "x"), false);
  assert.equal(security.isValidSession(""), false);
});

test("password verification does not accept a different password", () => {
  const security = createSecurity({ password: "test-only-long-password", secret: "test-only-session-secret-long-enough-to-sign", production: false });
  assert.equal(security.verifyPassword("test-only-long-password"), true);
  assert.equal(security.verifyPassword("different-password"), false);
});
