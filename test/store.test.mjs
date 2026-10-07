import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { originalPaymentFingerprint } from "../lib/policy.mjs";
import { createStore } from "../lib/store.mjs";

test("store enforces one active incident per original payment fingerprint", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "transferguard-store-"));
  const store = createStore(dataDir, randomBytes(32).toString("base64url"));
  t.after(async () => {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const transfer = {
    id: "sandbox-transfer-1",
    status: "PROCESSING",
    beneficiary_id: "sandbox-beneficiary-1",
    transfer_amount: "10.00",
    transfer_currency: "USD",
    transfer_method: "LOCAL",
    reference: "invoice-42",
  };
  const fingerprint = originalPaymentFingerprint(transfer);
  const input = {
    id: randomUUID(),
    mode: "sandbox",
    status: "IN_FLIGHT",
    transferId: transfer.id,
    requestId: randomUUID(),
    transfer,
    supplierName: "Test supplier",
    originalFingerprint: fingerprint,
  };
  const saved = store.createIncident(input);
  assert.equal(store.getDuplicateIncident(fingerprint).id, saved.id);
  assert.throws(() => store.createIncident({ ...input, id: randomUUID(), transferId: "sandbox-transfer-2" }), /UNIQUE constraint failed/);
});
