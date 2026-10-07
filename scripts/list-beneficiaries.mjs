import { config } from "../lib/config.mjs";

const baseUrl = "https://api.sandbox.airwallex.com/api/v1";
const usePrimaryKey = process.argv.includes("--primary");
const clientId = process.env.AIRWALLEX_BENEFICIARY_CLIENT_ID || config.airwallexClientId;
const apiKey = usePrimaryKey
  ? config.airwallexApiKey
  : process.env.AIRWALLEX_BENEFICIARY_API_KEY || config.airwallexApiKey;

function safeMessage(data, fallback) {
  return String(data?.error?.message || data?.message || fallback).slice(0, 200);
}

const authResponse = await fetch(`${baseUrl}/authentication/login`, {
  method: "POST",
  headers: {
    "x-client-id": clientId,
    "x-api-key": apiKey,
  },
  signal: AbortSignal.timeout(12000),
});
const authData = await authResponse.json().catch(() => ({}));
if (!authResponse.ok) {
  console.log(JSON.stringify({
    stage: "authentication",
    status: authResponse.status,
    code: authData?.error?.code || null,
    message: safeMessage(authData, "Authentication failed"),
  }, null, 2));
  process.exitCode = 1;
} else {
  const response = await fetch(`${baseUrl}/beneficiaries?page_num=0&page_size=100`, {
    headers: { Authorization: `Bearer ${authData.token}` },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.log(JSON.stringify({
      stage: "beneficiary_list",
      status: response.status,
      code: data?.error?.code || null,
      message: safeMessage(data, "Beneficiary list request failed"),
    }, null, 2));
    process.exitCode = 1;
  } else {
    const items = Array.isArray(data.items) ? data.items : [];
    console.log(JSON.stringify({
      status: response.status,
      count: items.length,
      hasMore: Boolean(data.has_more),
      beneficiaries: items.map((item) => {
        const beneficiary = item.beneficiary || item;
        const bank = beneficiary.bank_details || {};
        return {
          id: item.id || beneficiary.id || null,
          nickname: item.nickname || item.nick_name || beneficiary.nickname || null,
          currency: bank.account_currency || null,
          country: bank.bank_country_code || null,
          methods: item.transfer_methods || beneficiary.transfer_methods || [],
        };
      }),
    }, null, 2));
  }
}
