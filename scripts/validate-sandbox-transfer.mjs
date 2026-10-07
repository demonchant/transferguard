import { randomUUID } from "node:crypto";
import { config } from "../lib/config.mjs";

const beneficiaryId = process.argv[2];
if (!beneficiaryId) {
  console.error("Usage: node scripts/validate-sandbox-transfer.mjs BENEFICIARY_ID");
  process.exit(2);
}
const baseUrl = "https://api.sandbox.airwallex.com/api/v1";
const authResponse = await fetch(`${baseUrl}/authentication/login`, {
  method: "POST",
  headers: { "x-client-id": config.airwallexClientId, "x-api-key": config.airwallexApiKey },
  signal: AbortSignal.timeout(12000),
});
const auth = await authResponse.json().catch(() => ({}));
if (!authResponse.ok) {
  console.error(JSON.stringify({ stage: "authentication", status: authResponse.status, message: auth?.error?.message || "Authentication failed" }));
  process.exit(1);
}
const response = await fetch(`${baseUrl}/transfers/validate`, {
  method: "POST",
  headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    beneficiary_id: beneficiaryId,
    source_currency: "USD",
    transfer_amount: "10",
    transfer_currency: "USD",
    transfer_method: "LOCAL",
    reason: "goods_purchased",
    reference: "TG-TRANSFERGUARD-USD10-RETRY",
    request_id: randomUUID(),
  }),
  signal: AbortSignal.timeout(15000),
});
const data = await response.json().catch(() => ({}));
const apiError = data?.error || data;
function summarize(value, key = "") {
  if (Array.isArray(value)) return value.map((entry) => summarize(entry));
  if (!value || typeof value !== "object") {
    return ["code", "field", "parameter", "parameter_name", "message", "source", "type"].includes(key) && typeof value === "string"
      ? value
      : typeof value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, summarize(childValue, childKey)]));
}
console.log(JSON.stringify({
  status: response.status,
  valid: response.ok,
  code: apiError?.code || null,
  message: typeof apiError?.message === "string" ? apiError.message : null,
  responseShape: summarize(data),
}, null, 2));
