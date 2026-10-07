import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { config, validateConfig } from "./lib/config.mjs";
import { createStore } from "./lib/store.mjs";
import { airwallex, AirwallexError } from "./lib/airwallex.mjs";
import { analyzeSupplierMessage } from "./lib/claude.mjs";
import { bothTransfersVerified, decisionFor, originalPaymentFingerprint, replacementPayload } from "./lib/policy.mjs";
import { createSecurity, readSessionCookie } from "./lib/security.mjs";

validateConfig();
const store = createStore(config.dataDir, config.dataEncryptionKey);
const security = createSecurity({
  password: config.appPassword,
  secret: config.sessionSecret,
  production: process.env.NODE_ENV === "production",
});
const publicRoot = resolve("public");
const loginAttempts = new Map();
const bodyLimit = 16_000;
const port = Number(process.env.PORT || config.appPort);
const host = process.env.HOST || config.appHost;

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

function isAuthenticated(req) {
  return security.isValidSession(readSessionCookie(req.headers.cookie));
}

function requireOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin !== config.appOrigin) {
    const error = new Error("Request origin was not allowed.");
    error.status = 403;
    error.code = "origin_rejected";
    throw error;
  }
}

async function readJson(req) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("application/json")) {
    const error = new Error("Send JSON content.");
    error.status = 415;
    error.code = "content_type";
    throw error;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > bodyLimit) {
      const error = new Error("Request is too large.");
      error.status = 413;
      error.code = "body_too_large";
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request JSON is invalid.");
    error.status = 400;
    error.code = "invalid_json";
    throw error;
  }
}

function addSecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

function requireAuth(req) {
  if (!isAuthenticated(req)) {
    const error = new Error("Sign in to continue.");
    error.status = 401;
    error.code = "authentication_required";
    throw error;
  }
}

function parseIncidentId(pathname, action) {
  const match = pathname.match(new RegExp("^/api/incidents/([0-9a-f-]{36})/" + action + "$", "i"));
  return match?.[1] || null;
}

function publicIncident(row) {
  if (!row) return null;
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    originalTransferId: row.original_transfer_id,
    originalRequestId: row.original_request_id,
    transfer: row.original_json,
    supplierName: row.supplier_name,
    deadline: row.deadline,
    supplierMessage: row.supplier_message,
    evidence: row.evidence_json,
    replacementId: row.replacement_id,
    replacementRequestId: row.replacement_request_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decision: decisionFor(row.original_json, Boolean(row.replacement_id)),
  };
}

function recordTransfer(incident, transfer, source = "airwallex") {
  const decision = decisionFor(transfer, Boolean(incident.replacement_id));
  const status = decision.action === "RESOLVED" ? "RESOLVED" :
    decision.action === "REPLACEMENT_REQUIRES_APPROVAL" ? "REPLACEMENT_READY" :
      decision.action === "WAIT" ? "IN_FLIGHT" : decision.action;
  const updated = store.updateIncident(incident.id, incident.version, {
    transferId: transfer.id,
    transfer,
    requestId: transfer.request_id || incident.original_request_id,
    status,
  });
  store.addEvent(incident.id, "TRANSFER_STATE_READ", { status: transfer.status, failure: transfer.failure, decision }, source);
  return updated;
}

function validateText(value, max, field) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    const error = new Error(field + " is required and must be under " + max + " characters.");
    error.status = 400;
    error.code = "invalid_" + field;
    throw error;
  }
  return value.trim();
}

function appError(error) {
  if (error.status) return { status: error.status, code: error.code || "request_error", message: error.message };
  if (error.message === "INCIDENT_VERSION_CONFLICT") {
    return { status: 409, code: "state_changed", message: "The incident changed. Refresh it before continuing." };
  }
  if (error instanceof AirwallexError) {
    return { status: error.status || 502, code: error.code, message: error.message };
  }
  if (error.message?.includes("UNIQUE constraint failed")) {
    return { status: 409, code: "duplicate_incident", message: "That transfer already has an incident." };
  }
  if (error.message?.includes("one_open_proposal_per_incident")) {
    return { status: 409, code: "proposal_exists", message: "A replacement is already pending or needs reconciliation." };
  }
  return { status: 500, code: "internal_error", message: "The action failed safely. Review the incident and try again." };
}

function termsDigest(terms) {
  return createHash("sha256").update(JSON.stringify(terms)).digest("hex");
}

function supplierEvidenceDigest(message, details) {
  return createHash("sha256").update(JSON.stringify({
    message,
    source: details.source,
    sourceReference: details.sourceReference || "",
    recordedAt: details.receivedAt || details.preparedAt || "",
  })).digest("hex");
}

function currentSupplierEvidenceDigest(incident) {
  const sourceEvent = store.getEvents(incident.id).reverse().find((event) => event.kind === "SUPPLIER_MESSAGE_ADDED");
  if (!sourceEvent) return "";
  return supplierEvidenceDigest(incident.supplier_message, sourceEvent.details_json);
}

function currentSupplierEvidenceDetails(incident) {
  return store.getEvents(incident.id).reverse().find((event) => event.kind === "SUPPLIER_MESSAGE_ADDED")?.details_json || null;
}

async function createIncidentFromTransfer(body) {
  if (!config.airwallexClientId || !config.airwallexApiKey) {
    throw Object.assign(new Error("Add Airwallex sandbox credentials to the private environment before creating a transfer."), {
      status: 503, code: "credentials_missing",
    });
  }
  const supplierName = validateText(body.supplierName, 120, "supplier name");
  const beneficiaryId = validateText(body.beneficiaryId, 100, "beneficiary ID");
  const currency = validateText(body.currency, 3, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new Error("Use a three letter currency code."), { status: 400, code: "invalid_currency" });
  const amount = String(body.amount || "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 100000) {
    throw Object.assign(new Error("Amount must be greater than zero and no more than 100000 in major currency units."), { status: 400, code: "invalid_amount" });
  }
  if (body.confirmExactPayment !== true) {
    throw Object.assign(new Error("Confirm the exact sandbox payment before creating it."), { status: 400, code: "approval_required" });
  }
  const reason = validateText(body.reason || "goods_purchased", 40, "reason");
  const supportedReasons = new Set([
    "audio_visual_services", "bill_payment", "business_expenses", "construction",
    "donation_charitable_contribution", "education_training", "freight", "goods_purchased",
    "investment_capital", "investment_proceeds", "living_expenses", "loan_credit_repayment",
    "medical_services", "pension", "professional_business_services", "real_estate", "taxes",
    "technical_services", "transfer_to_own_account", "travel", "wages_salary", "other_services",
  ]);
  if (!supportedReasons.has(reason)) {
    throw Object.assign(new Error("Choose a transfer reason supported by Airwallex."), { status: 400, code: "invalid_reason" });
  }
  const reference = validateText(body.reference, 80, "reference");
  const transferMethod = body.transferMethod === "SWIFT" ? "SWIFT" : "LOCAL";
  const deadline = typeof body.deadline === "string" && body.deadline.length < 80 ? body.deadline : null;
  const requestId = randomUUID();
  const incidentId = randomUUID();
  const transferPayload = {
    beneficiary_id: beneficiaryId, reason, reference, request_id: requestId,
    source_currency: currency, transfer_currency: currency, transfer_amount: amount, transfer_method: transferMethod,
  };
  const originalFingerprint = originalPaymentFingerprint(transferPayload);
  const priorIncident = store.getDuplicateIncident(originalFingerprint);
  if (priorIncident) {
    store.addEvent(priorIncident.id, "DUPLICATE_PAYMENT_SUBMISSION_BLOCKED", {
      fingerprint: originalFingerprint.slice(0, 16),
    });
    return { incident: priorIncident, outcome: "duplicate_blocked" };
  }
  const pending = {
    id: "pending_" + requestId, status: "CREATION_PENDING", request_id: requestId,
    beneficiary_id: beneficiaryId, reason, reference, transfer_amount: amount,
    transfer_currency: currency, transfer_method: transferMethod, failure: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const incident = store.createIncident({
    id: incidentId, mode: "sandbox", status: "CREATION_PENDING",
    transferId: pending.id, requestId, transfer: pending, supplierName, deadline,
    originalFingerprint,
  });
  store.addEvent(incidentId, "ORIGINAL_TRANSFER_SUBMITTED", { requestId, beneficiaryId, amount, currency, reference });
  try {
    await airwallex.validateTransfer(transferPayload);
    store.addEvent(incidentId, "TRANSFER_VALIDATED", { requestId }, "airwallex");
    const transfer = await airwallex.createTransfer(transferPayload);
    const action = decisionFor(transfer).action;
    const status = action === "WAIT" ? "IN_FLIGHT" : action === "RESOLVED" ? "RESOLVED" : "OPEN";
    const updated = store.updateIncident(incidentId, incident.version, {
      transferId: transfer.id, transfer, status, requestId: transfer.request_id || requestId,
    });
    store.addEvent(incidentId, "ORIGINAL_TRANSFER_CREATED", { transferId: transfer.id, status: transfer.status }, "airwallex");
    return { incident: updated, outcome: "created" };
  } catch (error) {
    if (error instanceof AirwallexError && error.status >= 400 && error.status < 500 && error.code !== "network_ambiguous") {
      const current = store.getIncident(incidentId);
      const updated = store.setStatus(incidentId, current.version, "CREATION_REJECTED");
      store.addEvent(incidentId, "ORIGINAL_TRANSFER_REJECTED", { code: error.code }, "airwallex");
      return { incident: updated, outcome: "rejected", error };
    }
    try {
      const found = await airwallex.findByRequestId(requestId);
      if (found) {
        const current = store.getIncident(incidentId);
        const updated = store.updateIncident(incidentId, current.version, {
          transferId: found.id, transfer: found, status: "IN_FLIGHT", requestId,
        });
        store.addEvent(incidentId, "ORIGINAL_TRANSFER_RECONCILED", { transferId: found.id, status: found.status }, "airwallex");
        return { incident: updated, outcome: "reconciled" };
      }
    } catch {}
    const current = store.getIncident(incidentId);
    const updated = store.setStatus(incidentId, current.version, "AMBIGUOUS");
    store.addEvent(incidentId, "ORIGINAL_TRANSFER_AMBIGUOUS", { requestId }, "airwallex");
    return { incident: updated, outcome: "ambiguous" };
  }
}

async function handleApi(req, res, url) {
  const { pathname } = url;
  if (pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, { ok: true });
  }
  if (pathname === "/api/session" && req.method === "GET") {
    return json(res, 200, { authenticated: isAuthenticated(req) });
  }
  if (pathname === "/api/login" && req.method === "POST") {
    requireOrigin(req);
    const ip = req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || { count: 0, resetAt: now + 10 * 60_000 };
    if (now > attempts.resetAt) {
      attempts.count = 0;
      attempts.resetAt = now + 10 * 60_000;
    }
    if (attempts.count >= 8) {
      return json(res, 429, { error: { code: "login_limited", message: "Too many sign in attempts. Wait before trying again." } });
    }
    const body = await readJson(req);
    if (!security.verifyPassword(body.password)) {
      attempts.count += 1;
      loginAttempts.set(ip, attempts);
      return json(res, 401, { error: { code: "invalid_login", message: "The password did not match." } });
    }
    loginAttempts.delete(ip);
    const token = security.createSession();
    return json(res, 200, { ok: true }, { "Set-Cookie": security.cookie(token) });
  }
  if (pathname === "/api/logout" && req.method === "POST") {
    requireOrigin(req);
    requireAuth(req);
    return json(res, 200, { ok: true }, { "Set-Cookie": security.cookie("", 0) });
  }

  requireAuth(req);
  if (pathname === "/api/config" && req.method === "GET") {
    return json(res, 200, {
      mode: "Airwallex sandbox",
      airwallexReady: Boolean(config.airwallexClientId && config.airwallexApiKey),
      aiReady: Boolean(config.claudeApiKey),
      title: "TransferGuard",
    });
  }
  if (pathname === "/api/incidents" && req.method === "GET") {
    return json(res, 200, { incidents: store.listIncidents().map(publicIncident) });
  }
  if (pathname === "/api/incidents" && req.method === "POST") {
    requireOrigin(req);
    const body = await readJson(req);
    const result = await createIncidentFromTransfer(body);
    return json(res, result.outcome === "ambiguous" ? 202 : result.outcome === "rejected" ? 422 : result.outcome === "duplicate_blocked" ? 200 : 201, {
      incident: publicIncident(result.incident),
      outcome: result.outcome,
      ...(result.outcome === "duplicate_blocked" ? { message: "A matching payment already has an incident. Open it to review or reconcile it; no second transfer was sent." } : {}),
      ...(result.error ? { error: { code: result.error.code, message: result.error.message } } : {}),
    });
  }

  const messageId = parseIncidentId(pathname, "message");
  if (messageId && req.method === "POST") {
    requireOrigin(req);
    const body = await readJson(req);
    const incident = store.getIncident(messageId);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    const message = validateText(body.message, 6000, "supplier message");
    const source = validateText(body.source, 24, "supplier source");
    if (!["email", "supplier_portal", "phone", "other", "synthetic_scenario"].includes(source)) {
      return json(res, 400, { error: { code: "invalid_supplier_source", message: "Choose a valid supplier update source." } });
    }
    const isSynthetic = source === "synthetic_scenario";
    const recordedAtValue = validateText(body.receivedAt, 40, isSynthetic ? "scenario prepared time" : "received time");
    const recordedAtDate = new Date(recordedAtValue);
    if (!Number.isFinite(recordedAtDate.getTime())) {
      return json(res, 400, { error: { code: "invalid_received_time", message: isSynthetic ? "Enter when the scenario was prepared." : "Enter when the supplier update was received." } });
    }
    const sourceReference = typeof body.sourceReference === "string" ? body.sourceReference.trim().slice(0, 200) : "";
    const pendingProposal = store.getProposalForIncident(incident.id);
    const evidenceDetails = {
      source,
      sourceReference,
      ...(isSynthetic ? { preparedAt: recordedAtDate.toISOString() } : { receivedAt: recordedAtDate.toISOString() }),
    };
    const evidenceChanged = supplierEvidenceDigest(message, evidenceDetails) !== currentSupplierEvidenceDigest(incident);
    if (evidenceChanged && pendingProposal?.status === "PENDING") {
      store.updateProposalStatus(pendingProposal.id, "REJECTED");
    }
    const updated = store.updateIncident(incident.id, incident.version, {
      supplierMessage: message,
      ...(evidenceChanged && pendingProposal?.status === "PENDING" ? { status: "REPLACEMENT_READY" } : {}),
    });
    store.addEvent(incident.id, "SUPPLIER_MESSAGE_ADDED", {
      characterCount: message.length,
      ...evidenceDetails,
      sha256: createHash("sha256").update(message).digest("hex"),
    });
    return json(res, 200, { incident: publicIncident(updated) });
  }

  const analyzeId = parseIncidentId(pathname, "analyze");
  if (analyzeId && req.method === "POST") {
    requireOrigin(req);
    const incident = store.getIncident(analyzeId);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    if (!incident.supplier_message) return json(res, 400, { error: { code: "message_required", message: "Add a supplier message before analysis." } });
    const evidence = await analyzeSupplierMessage(incident.supplier_message, incident);
    const updated = store.updateIncident(incident.id, incident.version, { evidence });
    store.addEvent(incident.id, "SUPPLIER_MESSAGE_ANALYZED", { claims: evidence.claims, suggestedAction: evidence.suggested_action, model: evidence.model }, "claude");
    return json(res, 200, { incident: publicIncident(updated) });
  }

  const refreshId = parseIncidentId(pathname, "refresh");
  if (refreshId && req.method === "POST") {
    requireOrigin(req);
    const incident = store.getIncident(refreshId);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    const transfer = await airwallex.getTransfer(incident.original_transfer_id);
    const updated = recordTransfer(incident, transfer);
    return json(res, 200, { incident: publicIncident(updated), source: "Airwallex sandbox" });
  }

  const advanceId = parseIncidentId(pathname, "advance");
  if (advanceId && req.method === "POST") {
    requireOrigin(req);
    const body = await readJson(req);
    const incident = store.getIncident(advanceId);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    const currentStatus = String(incident.original_json.status || "").toUpperCase();
    const nextStatus = body.nextStatus;
    if (!["SENT", "FAILED", "PAID"].includes(nextStatus)) {
      return json(res, 400, { error: { code: "invalid_transition", message: "Choose a supported sandbox transition." } });
    }
    if (nextStatus === "SENT" && !["PROCESSING", "OVERDUE"].includes(currentStatus)) {
      return json(res, 409, { error: { code: "invalid_transition", message: "Only a processing transfer can move to sent." } });
    }
    if (nextStatus === "FAILED" && currentStatus !== "SENT") {
      return json(res, 409, { error: { code: "invalid_transition", message: "Move the transfer to sent before simulating a failure." } });
    }
    if (nextStatus === "FAILED" && body.failureType !== "BENEFICIARY_BANK_RETURNED" && body.failureType !== "RECALL_REQUESTED") {
      return json(res, 400, { error: { code: "failure_type_required", message: "Choose a bank return or recall failure." } });
    }
    const failureType = nextStatus === "FAILED" ? body.failureType : undefined;
    await airwallex.simulateTransfer(incident.original_transfer_id, nextStatus, failureType);
    const transfer = await airwallex.getTransfer(incident.original_transfer_id);
    const updated = recordTransfer(incident, transfer);
    store.addEvent(incident.id, "SANDBOX_STATE_SIMULATED", {
      requestedStatus: nextStatus, failureType: failureType || null, providerStatus: transfer.status,
    }, "airwallex");
    return json(res, 200, { incident: publicIncident(updated), source: "Airwallex sandbox" });
  }

  const proposalId = parseIncidentId(pathname, "proposal");
  if (proposalId && req.method === "POST") {
    requireOrigin(req);
    const body = await readJson(req);
    const incident = store.getIncident(proposalId);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    if (body.confirmSupplierNotReceived !== true) {
      return json(res, 400, { error: { code: "supplier_attestation_required", message: "Confirm that the saved update reports non receipt before proposing a replacement." } });
    }
    if (incident.supplier_message.length < 8) {
      return json(res, 400, { error: { code: "message_required", message: "Add the supplier update before proposing a replacement." } });
    }
    const existingProposal = store.getProposalForIncident(incident.id);
    if (existingProposal?.status === "PENDING") {
      return json(res, 200, {
        incident: publicIncident(incident),
        proposal: {
          id: existingProposal.id,
          terms: existingProposal.terms_json,
          termsHash: existingProposal.terms_hash,
          evidenceHash: existingProposal.evidence_hash,
          status: existingProposal.status,
        },
        reused: true,
      });
    }
    if (existingProposal && ["SUBMITTED", "AMBIGUOUS", "RECONCILED"].includes(existingProposal.status)) {
      return json(res, 409, { error: { code: "replacement_already_submitted", message: "This replacement request already exists. Reconcile or verify it instead of preparing another payment." } });
    }
    const current = await airwallex.getTransfer(incident.original_transfer_id);
    if (current.status !== "CANCELLED") {
      return json(res, 409, { error: { code: "original_not_terminal", message: "The original transfer is not a verified cancelled transfer. A replacement is blocked." } });
    }
    if (incident.replacement_id) {
      return json(res, 409, { error: { code: "replacement_exists", message: "A replacement already exists. Reconcile it instead of creating another." } });
    }
    const requestId = randomUUID();
    const terms = replacementPayload(current, requestId, incident.id);
    const evidenceHash = currentSupplierEvidenceDigest(incident);
    const id = randomUUID();
    const hash = termsDigest({ terms, evidenceHash });
    const proposal = store.createProposal({ id, incidentId: incident.id, requestId, terms, hash, evidenceHash });
    const updated = store.updateIncident(incident.id, incident.version, {
      transfer: current,
      status: "REPLACEMENT_PENDING",
      requestId: current.request_id || incident.original_request_id,
      replacementRequestId: requestId,
    });
    store.addEvent(incident.id, "APPROVAL_REQUIRED", { proposalId: id, amount: terms.transfer_amount, currency: terms.transfer_currency, evidenceHash });
    return json(res, 201, {
      incident: publicIncident(updated),
      proposal: { id: proposal.id, terms: proposal.terms_json, termsHash: proposal.terms_hash, evidenceHash: proposal.evidence_hash, status: proposal.status },
    });
  }

  const approveMatch = pathname.match(/^\/api\/proposals\/([0-9a-f-]{36})\/approve$/i);
  if (approveMatch && req.method === "POST") {
    requireOrigin(req);
    const body = await readJson(req);
    const proposal = store.getProposal(approveMatch[1]);
    if (!proposal) return json(res, 404, { error: { code: "not_found", message: "Approval proposal not found." } });
    const incident = store.getIncident(proposal.incident_id);
    if (body.confirmSupplierNotReceived !== true) {
      return json(res, 400, { error: { code: "supplier_attestation_required", message: "Confirm again that the saved update reports non receipt." } });
    }
    if (proposal.status !== "PENDING") return json(res, 409, { error: { code: "proposal_not_pending", message: "This proposal cannot be approved again." } });
    const currentEvidenceHash = currentSupplierEvidenceDigest(incident);
    if (!proposal.evidence_hash || currentEvidenceHash !== proposal.evidence_hash) {
      store.updateProposalStatus(proposal.id, "REJECTED");
      store.setStatus(incident.id, incident.version, "REPLACEMENT_READY");
      return json(res, 409, { error: { code: "supplier_evidence_changed", message: "The supplier update changed after review. Review the new evidence and prepare a fresh replacement proposal." } });
    }
    if (body.confirmationPhrase !== "APPROVE EXACT REPLACEMENT" || body.termsHash !== proposal.terms_hash ||
        termsDigest({ terms: proposal.terms_json, evidenceHash: proposal.evidence_hash }) !== proposal.terms_hash) {
      return json(res, 400, { error: { code: "approval_mismatch", message: "Review the exact terms and confirm them again." } });
    }
    const current = await airwallex.getTransfer(incident.original_transfer_id);
    if (current.status !== "CANCELLED") {
      store.updateProposalStatus(proposal.id, "REJECTED");
      store.setStatus(incident.id, incident.version, "ESCALATED");
      return json(res, 409, { error: { code: "original_changed", message: "The original state changed. The replacement was not sent." } });
    }
    await airwallex.validateTransfer(proposal.terms_json);
    store.addEvent(incident.id, "REPLACEMENT_TRANSFER_VALIDATED", {
      proposalId: proposal.id,
      requestId: proposal.request_id,
      amount: proposal.terms_json.transfer_amount,
      currency: proposal.terms_json.transfer_currency,
    }, "airwallex");
    store.addEvent(incident.id, "SUPPLIER_NON_RECEIPT_CONFIRMED", {
      proposalId: proposal.id,
      evidenceHash: proposal.evidence_hash,
      evidenceSource: currentSupplierEvidenceDetails(incident)?.source || "unknown",
      termsHash: proposal.terms_hash,
      confirmationPhrase: body.confirmationPhrase,
    });
    store.updateProposalStatus(proposal.id, "SUBMITTED");
    try {
      const created = await airwallex.createTransfer(proposal.terms_json);
      const updated = store.updateIncident(incident.id, incident.version, {
        status: "REPLACEMENT_IN_FLIGHT",
        replacementId: created.id,
        replacementRequestId: proposal.request_id,
      });
      store.addEvent(incident.id, "REPLACEMENT_CREATED", { transferId: created.id, status: created.status }, "airwallex");
      return json(res, 200, { incident: publicIncident(updated), source: "Airwallex sandbox" });
    } catch (error) {
      try {
        const found = await airwallex.findByRequestId(proposal.request_id);
        if (found) {
          const updated = store.updateIncident(incident.id, incident.version, {
            status: "REPLACEMENT_IN_FLIGHT",
            replacementId: found.id,
            replacementRequestId: proposal.request_id,
          });
          store.updateProposalStatus(proposal.id, "RECONCILED");
          store.addEvent(incident.id, "REPLACEMENT_RECONCILED", { transferId: found.id, status: found.status }, "airwallex");
          return json(res, 200, { incident: publicIncident(updated), source: "Airwallex sandbox reconciliation" });
        }
      } catch {}
      if (error instanceof AirwallexError && error.status >= 400 && error.status < 500 && error.code !== "duplicate_request_id") {
        store.updateProposalStatus(proposal.id, "REJECTED");
        store.setStatus(incident.id, incident.version, "REPLACEMENT_READY");
        store.addEvent(incident.id, "REPLACEMENT_CREATE_REJECTED", { requestId: proposal.request_id, code: error.code });
        throw error;
      }
      store.updateProposalStatus(proposal.id, "AMBIGUOUS");
      store.setStatus(incident.id, incident.version, "AMBIGUOUS");
      return json(res, 202, {
        incident: publicIncident(store.getIncident(incident.id)),
        error: { code: "outcome_ambiguous", message: "The result is unclear. No retry was sent. Reconcile this request ID before any further action." },
      });
    }
  }

  const reconcileId = parseIncidentId(pathname, "reconcile");
  if (reconcileId && req.method === "POST") {
    requireOrigin(req);
    const incident = store.getIncident(reconcileId);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    if (incident.status !== "AMBIGUOUS") {
      return json(res, 409, { error: { code: "not_ambiguous", message: "This incident does not need outcome reconciliation." } });
    }
    const isOriginalPending = incident.original_transfer_id.startsWith("pending_");
    const requestId = isOriginalPending ? incident.original_request_id : incident.replacement_request_id;
    if (!requestId) return json(res, 409, { error: { code: "request_id_missing", message: "No request ID is available to reconcile." } });
    const found = await airwallex.findByRequestId(requestId);
    if (!found) {
      store.addEvent(incident.id, "RECONCILIATION_NO_MATCH", { requestId }, "airwallex");
      return json(res, 202, {
        incident: publicIncident(incident),
        outcome: "still unclear",
        message: "Airwallex has not returned a transfer for this request ID. No new payment was sent.",
      });
    }
    if (isOriginalPending) {
      const action = decisionFor(found).action;
      const status = action === "WAIT" ? "IN_FLIGHT" : action === "RESOLVED" ? "RESOLVED" :
        action === "REPLACEMENT_REQUIRES_APPROVAL" ? "REPLACEMENT_READY" : "OPEN";
      const updated = store.updateIncident(incident.id, incident.version, {
        transferId: found.id, transfer: found, status, requestId,
      });
      store.addEvent(incident.id, "ORIGINAL_TRANSFER_RECONCILED", { transferId: found.id, status: found.status }, "airwallex");
      return json(res, 200, { incident: publicIncident(updated), outcome: "found" });
    }
    const proposal = store.getProposalForIncident(incident.id);
    if (proposal && ["SUBMITTED", "AMBIGUOUS"].includes(proposal.status)) {
      store.updateProposalStatus(proposal.id, "RECONCILED");
    }
    const updated = store.updateIncident(incident.id, incident.version, {
      status: "REPLACEMENT_IN_FLIGHT",
      replacementId: found.id,
      replacementRequestId: requestId,
    });
    store.addEvent(incident.id, "REPLACEMENT_RECONCILED", { transferId: found.id, status: found.status }, "airwallex");
    return json(res, 200, { incident: publicIncident(updated), outcome: "found" });
  }

  const verifyMatch = pathname.match(/^\/api\/incidents\/([0-9a-f-]{36})\/verify$/i);
  if (verifyMatch && req.method === "POST") {
    requireOrigin(req);
    const incident = store.getIncident(verifyMatch[1]);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    if (!incident.replacement_id) return json(res, 409, { error: { code: "replacement_missing", message: "There is no replacement to verify." } });
    const [original, replacement] = await Promise.all([
      airwallex.getTransfer(incident.original_transfer_id),
      airwallex.getTransfer(incident.replacement_id),
    ]);
    const verified = bothTransfersVerified(original, replacement);
    const status = verified ? "RESOLVED" :
      (original.status === "CANCELLED" && replacement.status !== "PAID" ? "ESCALATED" : "REPLACEMENT_IN_FLIGHT");
    const updated = store.updateIncident(incident.id, incident.version, { transfer: original, status });
    store.addEvent(incident.id, "INDEPENDENT_VERIFICATION", {
      originalStatus: original.status, replacementStatus: replacement.status, verified,
    }, "airwallex");
    return json(res, 200, { incident: publicIncident(updated), original, replacement, verified, source: "Airwallex sandbox" });
  }

  const eventsMatch = pathname.match(/^\/api\/incidents\/([0-9a-f-]{36})\/events$/i);
  if (eventsMatch && req.method === "GET") {
    const incident = store.getIncident(eventsMatch[1]);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    return json(res, 200, { events: store.getEvents(incident.id) });
  }

  const proposalStateMatch = pathname.match(/^\/api\/incidents\/([0-9a-f-]{36})\/proposal-state$/i);
  if (proposalStateMatch && req.method === "GET") {
    const incident = store.getIncident(proposalStateMatch[1]);
    if (!incident) return json(res, 404, { error: { code: "not_found", message: "Incident not found." } });
    const proposal = store.getProposalForIncident(incident.id);
    return json(res, 200, { proposal: proposal ? {
      id: proposal.id, terms: proposal.terms_json, termsHash: proposal.terms_hash, evidenceHash: proposal.evidence_hash, status: proposal.status,
    } : null });
  }

  const replacementStateMatch = pathname.match(/^\/api\/incidents\/([0-9a-f-]{36})\/replacement-state$/i);
  if (replacementStateMatch && req.method === "GET") {
    const incident = store.getIncident(replacementStateMatch[1]);
    if (!incident?.replacement_id) return json(res, 409, { error: { code: "replacement_missing", message: "There is no replacement transfer to read." } });
    const replacement = await airwallex.getTransfer(incident.replacement_id);
    return json(res, 200, { replacement, source: "Airwallex sandbox" });
  }

  const advanceReplacementId = parseIncidentId(pathname, "advance-replacement");
  if (advanceReplacementId && req.method === "POST") {
    requireOrigin(req);
    const body = await readJson(req);
    const incident = store.getIncident(advanceReplacementId);
    if (!incident?.replacement_id) return json(res, 409, { error: { code: "replacement_missing", message: "There is no replacement transfer to advance." } });
    const current = await airwallex.getTransfer(incident.replacement_id);
    const nextStatus = body.nextStatus;
    const allowed = (nextStatus === "SENT" && ["PROCESSING", "OVERDUE"].includes(current.status)) ||
      (nextStatus === "PAID" && current.status === "SENT");
    if (!allowed) return json(res, 409, { error: { code: "invalid_transition", message: "The replacement cannot move to that state from its current provider state." } });
    await airwallex.simulateTransfer(incident.replacement_id, nextStatus);
    const updatedTransfer = await airwallex.getTransfer(incident.replacement_id);
    const updated = store.updateIncident(incident.id, incident.version, {
      status: "REPLACEMENT_IN_FLIGHT",
    });
    store.addEvent(incident.id, "REPLACEMENT_STATE_SIMULATED", {
      requestedStatus: nextStatus, providerStatus: updatedTransfer.status,
    }, "airwallex");
    return json(res, 200, { incident: publicIncident(updated), replacement: updatedTransfer, source: "Airwallex sandbox" });
  }

  return json(res, 404, { error: { code: "not_found", message: "Page not found." } });
}

function staticFile(pathname, res) {
  const routes = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/app.css", ["app.css", "text/css; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/assets/transferguard-hero.svg", ["assets/transferguard-hero.svg", "image/svg+xml"]],
  ]);
  const entry = routes.get(pathname);
  if (!entry) return false;
  const path = resolve(publicRoot, entry[0]);
  if (!path.startsWith(publicRoot + sep) && path !== resolve(publicRoot, "index.html")) return false;
  if (!existsSync(path)) return false;
  res.writeHead(200, {
    "Content-Type": entry[1],
    "Cache-Control": entry[0].endsWith(".png") ? "public, max-age=86400" : "no-store",
  });
  createReadStream(path).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  addSecurityHeaders(res);
  const url = new URL(req.url || "/", config.appOrigin);
  try {
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json(res, 405, { error: { code: "method_not_allowed", message: "This method is not allowed." } });
    }
    if (!staticFile(url.pathname, res)) {
      return json(res, 404, { error: { code: "not_found", message: "Page not found." } });
    }
  } catch (error) {
    const safe = appError(error);
    if (safe.status >= 500) console.error("Request failed:", safe.code, String(error.message || "").slice(0, 160));
    if (!res.headersSent) json(res, safe.status, { error: { code: safe.code, message: safe.message } });
    else res.end();
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 25_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => {
  console.log("TransferGuard listening on " + host + ":" + port + " with Airwallex sandbox only.");
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
