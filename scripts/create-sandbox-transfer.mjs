import { config } from "../lib/config.mjs";

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : fallback;
}

const beneficiaryId = option("--beneficiary-id");
const amount = option("--amount");
const currency = option("--currency", "USD").toUpperCase();
const supplierName = option("--supplier-name", "Airwallex sandbox supplier");
const reference = option("--reference", `TG-SANDBOX-${Date.now()}`);
if (!beneficiaryId || !amount || !config.appPassword) {
  console.error("Usage: node scripts/create-sandbox-transfer.mjs --beneficiary-id ID --amount 10 [--currency USD]");
  process.exit(2);
}

const origin = config.appOrigin;
const login = await fetch(`${origin}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ password: config.appPassword }),
  signal: AbortSignal.timeout(10000),
});
const loginData = await login.json().catch(() => ({}));
if (!login.ok) {
  console.error(JSON.stringify({ stage: "login", status: login.status, message: loginData?.error?.message || "TransferGuard login failed" }));
  process.exit(1);
}
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
if (!cookie) {
  console.error(JSON.stringify({ stage: "login", status: login.status, message: "TransferGuard did not issue a session cookie" }));
  process.exit(1);
}

const response = await fetch(`${origin}/api/incidents`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: origin,
    Cookie: cookie,
  },
  body: JSON.stringify({
    supplierName,
    beneficiaryId,
    amount,
    currency,
    reference,
    reason: "goods_purchased",
    confirmExactPayment: true,
  }),
  signal: AbortSignal.timeout(45000),
});
const data = await response.json().catch(() => ({}));
if (!response.ok && !data.incident) {
  console.error(JSON.stringify({ stage: "transfer", status: response.status, code: data?.error?.code || null, message: data?.error?.message || "Transfer submission failed" }));
  process.exit(1);
}
console.log(JSON.stringify({
  httpStatus: response.status,
  outcome: data.outcome,
  incidentId: data.incident?.id || null,
  transferId: data.incident?.originalTransferId || null,
  requestId: data.incident?.originalRequestId || null,
  transferStatus: data.incident?.transfer?.status || null,
  amount: data.incident?.transfer?.transfer_amount || amount,
  currency: data.incident?.transfer?.transfer_currency || currency,
  reference,
  error: data.error?.message || null,
}, null, 2));
