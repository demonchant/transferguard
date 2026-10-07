import test from "node:test";
import assert from "node:assert/strict";
import { bothTransfersVerified, decisionFor, originalPaymentFingerprint, replacementPayload } from "../lib/policy.mjs";

test("an in flight transfer cannot be replaced", () => {
  for (const status of ["PROCESSING", "SENT", "FAILED", "UNKNOWN"]) {
    assert.equal(decisionFor({ status }).action, "WAIT");
  }
});

test("only terminal cancellation prepares a human approved replacement", () => {
  assert.equal(decisionFor({ status: "CANCELLED" }).action, "REPLACEMENT_REQUIRES_APPROVAL");
  assert.equal(decisionFor({ status: "PAID" }).action, "RESOLVED");
});

test("an incident resolves only after both provider records are verified", () => {
  assert.equal(bothTransfersVerified({ status: "CANCELLED" }, { status: "PAID" }), true);
  assert.equal(bothTransfersVerified({ status: "PROCESSING" }, { status: "PAID" }), false);
  assert.equal(bothTransfersVerified({ status: "CANCELLED" }, { status: "SENT" }), false);
  assert.equal(bothTransfersVerified({ status: "PAID" }, { status: "PAID" }), false);
});

test("replacement terms preserve amount and beneficiary with a new request ID", () => {
  const original = { status: "CANCELLED", beneficiary_id: "sandbox_beneficiary", transfer_amount: "125.00", transfer_currency: "USD", reason: "goods_purchased", transfer_method: "LOCAL" };
  const replacement = replacementPayload(original, "new-request-id", "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(replacement.beneficiary_id, original.beneficiary_id);
  assert.equal(replacement.transfer_amount, original.transfer_amount);
  assert.equal(replacement.source_currency, original.transfer_currency);
  assert.equal(replacement.request_id, "new-request-id");
  assert.notEqual(replacement.request_id, original.request_id);
});

test("replacement is rejected when provider identity or monetary terms are absent", () => {
  assert.throws(() => replacementPayload({ status: "CANCELLED" }, "id", "123e4567-e89b-12d3-a456-426614174000"), /beneficiary/);
  assert.throws(() => replacementPayload({ beneficiary_id: "b", transfer_amount: "1", transfer_currency: "US" }, "id", "123e4567-e89b-12d3-a456-426614174000"), /amount or currency/);
});

test("payment fingerprint ignores harmless formatting but distinguishes a new invoice", () => {
  const payment = { beneficiary_id: "beneficiary-1", transfer_amount: "10.00", transfer_currency: "USD", reference: "INV-42", transfer_method: "LOCAL" };
  assert.equal(originalPaymentFingerprint(payment), originalPaymentFingerprint({ ...payment, transfer_amount: "10", transfer_currency: "usd", reference: "inv-42" }));
  assert.notEqual(originalPaymentFingerprint(payment), originalPaymentFingerprint({ ...payment, reference: "INV-43" }));
  assert.notEqual(originalPaymentFingerprint(payment), originalPaymentFingerprint({ ...payment, transfer_amount: "11" }));
});
