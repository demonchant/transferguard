import { config } from "../lib/config.mjs";

const incidentId = process.argv[2];
if (!incidentId) {
  console.error("Usage: node scripts/reconcile-sandbox-incident.mjs INCIDENT_ID");
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
const response = await fetch(`${origin}/api/incidents/${encodeURIComponent(incidentId)}/reconcile`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
  body: "{}",
  signal: AbortSignal.timeout(30000),
});
const data = await response.json().catch(() => ({}));
console.log(JSON.stringify({
  httpStatus: response.status,
  outcome: data.outcome || null,
  incidentId: data.incident?.id || null,
  transferId: data.incident?.originalTransferId || null,
  transferStatus: data.incident?.transfer?.status || null,
  amount: data.incident?.transfer?.transfer_amount || null,
  currency: data.incident?.transfer?.transfer_currency || null,
  message: data.message || data.error?.message || null,
}, null, 2));
if (!response.ok) process.exitCode = 1;
