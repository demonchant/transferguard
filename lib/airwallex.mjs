import { config } from "./config.mjs";

const BASE_URL = "https://api.sandbox.airwallex.com/api/v1";
let accessToken = null;
let tokenExpiresAt = 0;

export class AirwallexError extends Error {
  constructor(message, status = 0, code = "provider_error") {
    super(message);
    this.name = "AirwallexError";
    this.status = status;
    this.code = code;
  }
}

function requireSandboxCredentials() {
  if (config.airwallexMode !== "sandbox") {
    throw new AirwallexError("Airwallex sandbox mode is not enabled.", 503, "sandbox_not_enabled");
  }
  if (!config.airwallexClientId || !config.airwallexApiKey) {
    throw new AirwallexError("Airwallex sandbox credentials are not configured.", 503, "credentials_missing");
  }
}

async function decodeResponse(response) {
  const body = await response.text();
  let parsed = {};
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    parsed = {};
  }
  if (!response.ok) {
    const apiError = parsed?.error ?? parsed;
    const code = String(apiError?.code ?? apiError?.type ?? "provider_error").slice(0, 80);
    const message = String(apiError?.message ?? apiError?.details ?? "Airwallex request failed").slice(0, 240);
    throw new AirwallexError(message, response.status, code);
  }
  return parsed;
}

async function authenticate(force = false) {
  requireSandboxCredentials();
  if (!force && accessToken && Date.now() < tokenExpiresAt - 30_000) return accessToken;
  let response;
  try {
    response = await fetch(BASE_URL + "/authentication/login", {
      method: "POST",
      headers: {
        "x-client-id": config.airwallexClientId,
        "x-api-key": config.airwallexApiKey,
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new AirwallexError("Could not reach Airwallex authentication.", 503, "network_error");
  }
  const data = await decodeResponse(response);
  if (!data.token || !data.expires_at) throw new AirwallexError("Airwallex authentication response was incomplete.", 502, "invalid_auth_response");
  accessToken = data.token;
  const expiry = Date.parse(data.expires_at);
  tokenExpiresAt = Number.isFinite(expiry) ? expiry : Date.now() + 25 * 60_000;
  return accessToken;
}

async function request(path, options = {}, retried = false) {
  const token = await authenticate();
  let response;
  try {
    response = await fetch(BASE_URL + path, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AirwallexError("Airwallex request timed out or could not connect.", 503, "network_ambiguous");
  }
  if (response.status === 401 && !retried) {
    await authenticate(true);
    return request(path, options, true);
  }
  return decodeResponse(response);
}

export function sanitizeTransfer(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string") {
    throw new AirwallexError("Airwallex returned an invalid transfer.", 502, "invalid_transfer");
  }
  const beneficiary = raw.beneficiary && typeof raw.beneficiary === "object" ? raw.beneficiary : {};
  return {
    id: raw.id,
    status: String(raw.status || "UNKNOWN").toUpperCase(),
    request_id: raw.request_id || null,
    beneficiary_id: raw.beneficiary_id || null,
    beneficiary_name: beneficiary.company_name || [beneficiary.first_name, beneficiary.last_name].filter(Boolean).join(" ") || null,
    reason: raw.reason || "goods_purchased",
    reference: raw.reference || raw.short_reference_id || raw.id,
    transfer_amount: raw.transfer_amount === undefined ? null : String(raw.transfer_amount),
    transfer_currency: raw.transfer_currency || null,
    transfer_method: raw.transfer_method || null,
    failure: raw.failure ? {
      code: raw.failure.code || null,
      message: raw.failure.message || null,
      type: raw.failure.type || raw.failure_type || null,
      details: raw.failure.details && typeof raw.failure.details === "object" ? raw.failure.details : null,
    } : (raw.failure_type || raw.failure_reason ? {
      code: null, type: raw.failure_type || null, message: raw.failure_reason || null, details: null,
    } : null),
    created_at: raw.created_at || null,
    updated_at: raw.updated_at || null,
  };
}

export const airwallex = {
  async validateTransfer(payload) {
    return request("/transfers/validate", { method: "POST", body: JSON.stringify(payload) });
  },
  async getTransfer(id) {
    const result = await request("/transfers/" + encodeURIComponent(id));
    return sanitizeTransfer(result);
  },
  async findByRequestId(requestId) {
    const query = new URLSearchParams({ request_id: requestId, page_size: "10" });
    const result = await request("/transfers?" + query.toString());
    const items = Array.isArray(result.items) ? result.items : [];
    return items.find((item) => item.request_id === requestId) ? sanitizeTransfer(items.find((item) => item.request_id === requestId)) : null;
  },
  async createTransfer(payload) {
    const result = await request("/transfers/create", { method: "POST", body: JSON.stringify(payload) });
    return sanitizeTransfer(result);
  },
  async simulateTransfer(id, nextStatus, failureType) {
    const body = { next_status: nextStatus };
    if (failureType) body.failure_type = failureType;
    return request("/simulation/transfers/" + encodeURIComponent(id) + "/transition", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};
