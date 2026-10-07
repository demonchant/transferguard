import { config } from "../lib/config.mjs";

const incidentId = process.argv[2];
if (!incidentId) {
  console.error("Usage: node scripts/simulate-sandbox-return.mjs INCIDENT_ID");
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
for (const step of [
  { nextStatus: "SENT" },
  { nextStatus: "FAILED", failureType: "BENEFICIARY_BANK_RETURNED" },
]) {
  const response = await fetch(`${origin}/api/incidents/${encodeURIComponent(incidentId)}/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie },
    body: JSON.stringify(step),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  console.log(JSON.stringify({
    requestedStatus: step.nextStatus,
    httpStatus: response.status,
    providerStatus: data.incident?.transfer?.status || null,
    incidentStatus: data.incident?.status || null,
    transferId: data.incident?.originalTransferId || null,
    error: data.error?.message || null,
  }));
  if (!response.ok) process.exit(1);
}
