const state = { incidents: [], current: null, proposal: null, replacement: null, config: null, events: [] };
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (transfer) => transfer?.transfer_amount ? `${esc(transfer.transfer_currency || "")} ${esc(transfer.transfer_amount)}` : "Amount pending";
const labels = { INCIDENT_CREATED: "Incident created", ORIGINAL_TRANSFER_SUBMITTED: "Transfer sent to Airwallex", TRANSFER_VALIDATED: "Airwallex validated transfer terms", REPLACEMENT_TRANSFER_VALIDATED: "Airwallex validated replacement terms", REPLACEMENT_CREATE_REJECTED: "Airwallex rejected replacement terms", ORIGINAL_TRANSFER_CREATED: "Sandbox transfer created", TRANSFER_STATE_READ: "Provider state checked", SUPPLIER_MESSAGE_ADDED: "Supplier update saved", SUPPLIER_MESSAGE_ANALYZED: "Supplier update reviewed by Claude", SUPPLIER_NON_RECEIPT_CONFIRMED: "Operator confirmed saved update", SANDBOX_STATE_SIMULATED: "Airwallex sandbox state simulated", APPROVAL_REQUIRED: "Replacement approval prepared", REPLACEMENT_PROPOSED: "Replacement terms prepared", PROPOSAL_SUBMITTED: "Replacement sent to Airwallex", REPLACEMENT_CREATED: "Replacement transfer created", REPLACEMENT_RECONCILED: "Replacement result reconciled", INDEPENDENT_VERIFICATION: "Payment outcome verified", ORIGINAL_TRANSFER_RECONCILED: "Original transfer reconciled", RECONCILIATION_NO_MATCH: "No transfer found for request yet", DUPLICATE_PAYMENT_SUBMISSION_BLOCKED: "Duplicate transfer attempt blocked" };
function eventLabel(event) {
  if (event.kind === "SUPPLIER_MESSAGE_ADDED" && event.details_json?.source === "synthetic_scenario") return "Synthetic scenario recorded";
  if (event.kind === "SUPPLIER_NON_RECEIPT_CONFIRMED" && event.details_json?.evidenceSource === "synthetic_scenario") return "Operator confirmed synthetic scenario";
  return labels[event.kind] || event.kind.replaceAll("_", " ").toLowerCase();
}

function toast(title, message, error = false) {
  const item = document.createElement("div"); item.className = `toast${error ? " error" : ""}`;
  item.innerHTML = `<strong>${esc(title)}</strong>${esc(message)}`; $("toastStack").prepend(item); setTimeout(() => item.remove(), 7000);
  if ($("guideStatus")) { $("guideStatus").textContent = error ? "Needs your attention" : title; $("guideMessage").textContent = message; $("guideBuddy").classList.toggle("buddyAlert", error); }
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: "same-origin", headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) throw new Error(data.error?.message || "The request could not be completed.");
  return { ...data, httpStatus: response.status };
}
const post = (path, data = {}) => api(path, { method: "POST", body: JSON.stringify(data) });
function setIncident(incident) { state.current = incident; if (incident) state.incidents = [incident, ...state.incidents.filter((item) => item.id !== incident.id)]; render(); }
function renderList() {
  $("incidentCount").textContent = String(state.incidents.length);
  $("openStat").textContent = String(state.incidents.filter((x) => !["RESOLVED", "CREATION_REJECTED"].includes(x.status)).length);
  $("reviewStat").textContent = String(state.incidents.filter((x) => ["REPLACEMENT_READY", "REPLACEMENT_PENDING", "AMBIGUOUS"].includes(x.status)).length);
  $("verifiedStat").textContent = String(state.incidents.filter((x) => x.status === "RESOLVED").length);
  $("incidentList").innerHTML = state.incidents.length ? state.incidents.map((item) => `<button class="incidentRow ${state.current?.id === item.id ? "selected" : ""}" data-incident="${esc(item.id)}"><span class="incidentGlyph">◈</span><span class="incidentRowText"><strong>${esc(item.supplierName)}</strong><small>${esc(item.transfer?.reference || item.originalTransferId)} · ${esc(String(item.status).replaceAll("_", " "))}</small></span><span class="statusDot ${item.status === "RESOLVED" ? "good" : item.status === "AMBIGUOUS" ? "bad" : ""}"></span></button>`).join("") : `<div class="emptyList">No transfers yet. Create one in your Airwallex sandbox to begin.</div>`;
  document.querySelectorAll("[data-incident]").forEach((button) => button.addEventListener("click", () => selectIncident(button.dataset.incident)));
}
function actionButton(label, action, kind = "") { return `<button class="smallAction ${kind}" data-action="${esc(action)}">${esc(label)}</button>`; }
function renderDetail() {
  const empty = document.querySelector(".emptyDetail"), detail = $("incidentDetail"), item = state.current;
  empty.classList.toggle("hidden", Boolean(item)); detail.classList.toggle("hidden", !item);
  if (!item) return;
  const tr = item.transfer || {}, status = String(tr.status || item.status), isProcessing = ["PROCESSING", "OVERDUE"].includes(status), isSent = status === "SENT", cancelled = status === "CANCELLED", replacementStatus = state.replacement?.status;
  const latestEvidenceEvent = [...state.events].reverse().find((event) => event.kind === "SUPPLIER_MESSAGE_ADDED");
  const syntheticEvidence = latestEvidenceEvent?.details_json?.source === "synthetic_scenario";
  const attestationText = syntheticEvidence ? "I confirm this synthetic scenario states that the original payment was not received." : "I confirm the saved supplier update states that the original payment was not received.";
  let actions = actionButton("Refresh provider state", "refresh");
  if (item.status === "AMBIGUOUS") actions += actionButton("Reconcile request", "reconcile", "accent");
  if (isProcessing) actions += actionButton("Simulate sent state", "sent");
  if (isSent) actions += actionButton("Simulate bank return", "failed", "danger");
  if (cancelled && !item.replacementId && item.supplierMessage.length >= 8 && (!state.proposal || ["REJECTED", "RECONCILED"].includes(state.proposal.status))) actions += actionButton("Prepare replacement terms", "proposal", "accent");
  if (item.replacementId) {
    actions += actionButton("Refresh replacement state", "refreshReplacement");
    if (["PROCESSING", "OVERDUE"].includes(replacementStatus)) actions += actionButton("Simulate sent state on replacement", "replacementSent");
    if (replacementStatus === "SENT") actions += actionButton("Simulate paid state on replacement", "replacementPaid", "accent");
    if (item.status !== "RESOLVED") actions += actionButton("Verify both transfers", "verify", "accent");
  }
  if (state.proposal?.status === "PENDING") actions += `<div class="detailApproval"><h4>Review exact replacement terms</h4><div class="termGrid"><div><small>Amount</small><strong>${money(state.proposal.terms)}</strong></div><div><small>Beneficiary</small><strong>${esc(state.proposal.terms.beneficiary_id)}</strong></div><div><small>Reference</small><strong>${esc(state.proposal.terms.reference)}</strong></div><div><small>Terms and evidence proof</small><strong>${esc(state.proposal.termsHash.slice(0, 16))}</strong></div><div><small>Supplier evidence fingerprint</small><strong>${esc((state.proposal.evidenceHash || "").slice(0, 16))}</strong></div></div><p class="confidenceNote">Approval is bound to these transfer terms and the saved evidence, including its source. Changing it invalidates this proposal.</p><label class="checkRow"><input id="supplierAttest" type="checkbox"><span>${esc(attestationText)}</span></label><label for="approvalPhrase">Type APPROVE EXACT REPLACEMENT</label><input id="approvalPhrase" class="approvalInput" autocomplete="off"><button class="smallAction accent" data-action="approve">Approve and send exact replacement</button></div>`;
  const timeline = state.events.slice(-4).reverse().map((event) => `<div class="timelineRow"><span class="timelineMark">✓</span><span class="timelineText"><strong>${esc(eventLabel(event))}</strong><small>${esc(event.source)} · ${new Date(event.created_at).toLocaleString()}</small></span><time>${esc(event.kind)}</time></div>`).join("");
  detail.innerHTML = `<div class="detailTop"><div class="detailTitle"><div class="eyebrow darkEyebrow">LIVE AIRWALLEX SANDBOX RECORD</div><h3>${esc(item.supplierName)}</h3><p>${esc(item.originalTransferId)}</p></div><span class="statusPill ${status === "PAID" || item.status === "RESOLVED" ? "good" : status === "FAILED" || item.status === "AMBIGUOUS" ? "bad" : ""}">${esc((item.status === "RESOLVED" ? item.status : status).replaceAll("_", " "))}</span></div><div class="detailMoney"><strong>${money(tr)}</strong><span>${esc(tr.transfer_method || "Sandbox transfer")}</span></div><div class="decisionBox"><span class="decisionMark">✓</span><div><strong>${item.status === "RESOLVED" ? "Both provider records confirm payment" : cancelled ? "Original payment is cancelled" : "Current source state is " + status.replaceAll("_", " ")}</strong><p>${cancelled ? "A replacement stays blocked until the update is saved and you confirm what it states." : "Transfer state is read from Airwallex. An uncertain outcome always waits for reconciliation."}</p></div></div><div class="actionRow">${actions}</div><div class="actionFeedback" id="actionFeedback" aria-live="polite">${item.status === "RESOLVED" ? "Verified against both Airwallex transfer records." : "Every change is recorded below."}</div><form class="messageForm" id="messageForm"><label for="supplierMessage">Supplier update or scenario statement</label><textarea id="supplierMessage" maxlength="6000" placeholder="Paste the supplier reply or enter a clearly labeled scenario statement" required>${esc(item.supplierMessage)}</textarea><div class="messageButtons"><button class="smallAction" type="submit">Save update</button><button class="smallAction accent" type="button" data-action="analyze">Optional Claude evidence review</button></div><small>Claude review is optional. Payment status and approval do not depend on it.</small></form>${item.evidence ? `<div class="evidenceQuote">${esc(item.evidence.summary || "Claude reviewed the supplied message.")}<br><small>Claude ${esc(item.evidence.model || "")}</small></div>` : ""}<div class="timeline">${timeline || "<small>No recorded actions yet.</small>"}</div>`;
  $("messageForm").insertAdjacentHTML("afterbegin", `<label for="supplierSource">Evidence source</label><select id="supplierSource" required><option value="">Choose a source</option><option value="email">Email</option><option value="supplier_portal">Supplier portal</option><option value="phone">Phone call</option><option value="other">Other</option><option value="synthetic_scenario">Synthetic hackathon scenario</option></select><label for="supplierReference">Email subject or scenario label</label><input id="supplierReference" maxlength="200" placeholder="Optional source reference"><label for="supplierReceivedAt" id="evidenceDateLabel">When did you receive it?</label><input id="supplierReceivedAt" type="datetime-local" required><small id="evidenceSourceHelp">TransferGuard records the source details you enter. It cannot independently authenticate a supplier or message.</small>`);
  $("supplierSource").addEventListener("change", () => updateEvidenceSourceForm());
  updateEvidenceSourceForm();
  detail.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => runAction(button.dataset.action)));
  $("messageForm").addEventListener("submit", saveMessage);
}
function renderEvidence() {
  const target = $("evidenceContent"), item = state.current;
  if (!item) { target.innerHTML = `<div class="quietEmpty">Select an incident to review its saved supplier update and evidence.</div>`; return; }
  const latestSource = [...state.events].reverse().find((event) => event.kind === "SUPPLIER_MESSAGE_ADDED")?.details_json?.source;
  const synthetic = latestSource === "synthetic_scenario";
  target.innerHTML = `<div class="evidenceCard"><div><div class="eyebrow darkEyebrow">${synthetic ? "SYNTHETIC HACKATHON SCENARIO" : "EVIDENCE SOURCE"}</div><h3>${esc(item.supplierName)}</h3>${synthetic ? "<p class=\"confidenceNote\">Scenario data only. No real supplier sent this message.</p>" : ""}</div>${item.supplierMessage ? `<blockquote class="evidenceQuote">${esc(item.supplierMessage)}</blockquote>` : `<p class="quietEmpty">No supplier update has been saved.</p>`}${item.evidence ? `<div><div class="eyebrow darkEyebrow">CLAUDE REVIEW</div><p>${esc((item.evidence.claims || []).length)} quoted claims and ${(item.evidence.uncertainty || []).length} uncertainty notes extracted.</p>${(item.evidence.claims || []).map((claim) => `<div class="claimRow"><span class="claimKind">${esc(claim.kind.replaceAll("_", " "))}</span><span class="claimQuote">${esc(claim.quote)}</span></div>`).join("")}${(item.evidence.uncertainty || []).map((note) => `<p class="confidenceNote">${esc(note)}</p>`).join("")}<small class="confidenceNote">Review is decision support. A person confirms the supplier statement.</small></div>` : ""}</div>`;
}
function updateEvidenceSourceForm() {
  const synthetic = $("supplierSource").value === "synthetic_scenario";
  $("evidenceDateLabel").textContent = synthetic ? "When was this scenario prepared?" : "When did you receive it?";
  $("supplierReference").placeholder = synthetic ? "Optional scenario label" : "Optional source reference";
  $("evidenceSourceHelp").textContent = synthetic
    ? "Synthetic scenario data only. This is not a real supplier message."
    : "TransferGuard records the source details you enter. It cannot independently authenticate the supplier or message.";
  const dateInput = $("supplierReceivedAt");
  if (synthetic && !dateInput.value) {
    const now = new Date();
    dateInput.value = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    dateInput.dataset.scenarioTime = "true";
  } else if (!synthetic && dateInput.dataset.scenarioTime === "true") {
    dateInput.value = "";
    delete dateInput.dataset.scenarioTime;
  }
}
function renderEvidenceProvenance() {
  if (!state.current) return;
  const sourceEvent = [...state.events].reverse().find((event) => event.kind === "SUPPLIER_MESSAGE_ADDED");
  const card = $("evidenceContent").querySelector(".evidenceCard");
  if (!sourceEvent || !card) return;
  const source = sourceEvent.details_json || {};
  const note = document.createElement("div");
  note.className = "confidenceNote";
  note.textContent = source.source === "synthetic_scenario"
    ? `Synthetic hackathon scenario. No real supplier sent this text. Prepared ${source.preparedAt ? new Date(source.preparedAt).toLocaleString() : ""} · scenario fingerprint ${String(source.sha256 || "").slice(0, 16)}`
    : `Operator recorded ${String(source.source || "source unknown").replaceAll("_", " ")}${source.sourceReference ? ` · ${source.sourceReference}` : ""}${source.receivedAt ? ` · received ${new Date(source.receivedAt).toLocaleString()}` : ""} · message fingerprint ${String(source.sha256 || "").slice(0, 16)}`;
  card.append(note);
}
function renderActivity() {
  const target = $("activityContent");
  if (!state.current) { target.innerHTML = `<div class="quietEmpty">Select an incident to view its recorded actions.</div>`; return; }
  target.innerHTML = `<div class="eventList">${state.events.map((event) => `<div class="eventRow"><span class="eventIcon">✓</span><div><strong>${esc(eventLabel(event))}</strong><p>${esc(JSON.stringify(event.details_json))}<br>${esc(event.source)}</p></div><time>${new Date(event.created_at).toLocaleString()}</time></div>`).join("")}</div>`;
}
function render() { renderList(); renderDetail(); renderEvidence(); renderEvidenceProvenance(); renderActivity(); }
async function selectIncident(id) {
  state.current = state.incidents.find((x) => x.id === id) || null;
  const [events, proposal, replacement] = await Promise.all([api(`/api/incidents/${id}/events`), api(`/api/incidents/${id}/proposal-state`).catch(() => ({ proposal: null })), state.current?.replacementId ? api(`/api/incidents/${id}/replacement-state`).catch(() => ({ replacement: null })) : Promise.resolve({ replacement: null })]);
  state.events = events.events || []; state.proposal = proposal.proposal || null; state.replacement = replacement.replacement || null; render();
}
async function reload() {
  const [list, config] = await Promise.all([api("/api/incidents"), api("/api/config")]);
  state.incidents = list.incidents; state.config = config;
  $("connectionText").textContent = config.airwallexReady ? "Sandbox connected" : "Sandbox credentials needed";
  $("modePill").textContent = "Airwallex sandbox";
  if (state.current) { const found = state.incidents.find((x) => x.id === state.current.id); if (found) await selectIncident(found.id); else state.current = null; }
  else if (state.incidents[0]) await selectIncident(state.incidents[0].id); else render();
}
function openCreate() { $("actionDialog").showModal(); }
async function createTransfer(event) {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const result = await post("/api/incidents", { supplierName: $("supplierInput").value, beneficiaryId: $("beneficiaryInput").value, amount: $("amountInput").value, currency: $("currencyInput").value, reference: $("referenceInput").value, reason: $("reasonInput").value, deadline: $("deadlineInput").value, confirmExactPayment: $("confirmPaymentInput").checked });
    $("actionDialog").close(); form.reset();
    toast(result.outcome === "ambiguous" ? "Result needs reconciliation" : result.outcome === "reconciled" ? "Transfer found by request ID" : result.outcome === "duplicate_blocked" ? "Duplicate payment stopped" : "Sandbox transfer created", result.outcome === "ambiguous" ? "No repeat payment was sent. Reconcile the saved request ID before taking another action." : result.outcome === "duplicate_blocked" ? result.message : `Airwallex returned ${result.incident.transfer?.status || result.outcome}.`);
    await reload(); if (result.incident) await selectIncident(result.incident.id);
  } catch (error) { toast("Transfer was not created", error.message, true); } finally { button.disabled = false; }
}
async function saveMessage(event) {
  event.preventDefault(); if (!state.current) return;
  try { const result = await post(`/api/incidents/${state.current.id}/message`, { message: $("supplierMessage").value, source: $("supplierSource").value, sourceReference: $("supplierReference").value, receivedAt: $("supplierReceivedAt").value }); setIncident(result.incident); toast("Supplier update saved", "The encrypted text and operator recorded source details are in the activity record."); await selectIncident(result.incident.id); }
  catch (error) { toast("Update was not saved", error.message, true); }
}
async function runAction(action) {
  const item = state.current; if (!item) return;
  try {
    let result;
    if (action === "refresh") result = await post(`/api/incidents/${item.id}/refresh`);
    else if (action === "sent") result = await post(`/api/incidents/${item.id}/advance`, { nextStatus: "SENT" });
    else if (action === "failed") result = await post(`/api/incidents/${item.id}/advance`, { nextStatus: "FAILED", failureType: "BENEFICIARY_BANK_RETURNED" });
    else if (action === "proposal") {
      if (!item.supplierMessage) throw new Error("Save the supplier update before preparing a replacement.");
      const evidenceIsSynthetic = [...state.events].reverse().find((event) => event.kind === "SUPPLIER_MESSAGE_ADDED")?.details_json?.source === "synthetic_scenario";
      const attested = window.confirm(`${evidenceIsSynthetic ? "Confirm the synthetic scenario states" : "Confirm the saved supplier update states"} that the original payment was not received. This prepares exact replacement terms for your review.`);
      if (!attested) return;
      result = await post(`/api/incidents/${item.id}/proposal`, { confirmSupplierNotReceived: true }); state.proposal = result.proposal;
    } else if (action === "approve") {
      const phrase = $("approvalPhrase")?.value || "";
      result = await post(`/api/proposals/${state.proposal.id}/approve`, { confirmationPhrase: phrase, termsHash: state.proposal.termsHash, confirmSupplierNotReceived: $("supplierAttest")?.checked === true });
    } else if (action === "reconcile") result = await post(`/api/incidents/${item.id}/reconcile`);
    else if (action === "verify") result = await post(`/api/incidents/${item.id}/verify`);
    else if (action === "refreshReplacement") { result = await post(`/api/incidents/${item.id}/verify`); }
    else if (action === "replacementSent") result = await post(`/api/incidents/${item.id}/advance-replacement`, { nextStatus: "SENT" });
    else if (action === "replacementPaid") result = await post(`/api/incidents/${item.id}/advance-replacement`, { nextStatus: "PAID" });
    else if (action === "analyze") { result = await post(`/api/incidents/${item.id}/analyze`); }
    setIncident(result.incident || item); await selectIncident(item.id);
    const message = result.verified ? "Airwallex confirms the original is cancelled and the replacement is paid." : result.message || result.error?.message || `Current provider state: ${result.incident?.transfer?.status || result.outcome || "updated"}.`;
    toast(result.verified ? "Outcome verified" : "Action recorded", message, Boolean(result.error));
  } catch (error) { toast("Action needs attention", error.message, true); }
}
function nav() {
  document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-page]").forEach((x) => x.classList.toggle("active", x === button));
    document.querySelectorAll(".pageView").forEach((x) => x.classList.toggle("active", x.id === `${button.dataset.page}Page`));
    $("pageName").textContent = button.textContent.trim();
  }));
  $("allIncidentsButton").addEventListener("click", () => document.querySelector('[data-page="activity"]').click());
}
function initGuide() {
  const card = $("guideCard"), buddy = $("guideBuddy");
  const toggle = (open) => { card.classList.toggle("hidden", !open); buddy.setAttribute("aria-expanded", String(open)); };
  buddy.addEventListener("click", () => toggle(card.classList.contains("hidden")));
  $("guideClose").addEventListener("click", () => { toggle(false); buddy.focus(); });
  $("guideStart").addEventListener("click", () => { toggle(false); openCreate(); });
  $("guideActivity").addEventListener("click", () => { toggle(false); document.querySelector('[data-page="activity"]').click(); });
}
async function init() {
  nav(); initGuide(); $("heroAction").addEventListener("click", openCreate); $("emptyAction").addEventListener("click", openCreate); $("newIncidentButton").addEventListener("click", openCreate);
  $("cancelAction").addEventListener("click", () => $("actionDialog").close()); $("closeActionDialog").addEventListener("click", () => $("actionDialog").close()); $("actionForm").addEventListener("submit", createTransfer);
  $("refreshButton").addEventListener("click", async () => { try { await reload(); if (state.current) await runAction("refresh"); toast("Workspace refreshed", "Current transfer state was read from Airwallex."); } catch (error) { toast("Refresh failed", error.message, true); } });
  $("logoutButton").addEventListener("click", async () => { await post("/api/logout"); location.reload(); });
  $("loginForm").addEventListener("submit", async (event) => { event.preventDefault(); try { await post("/api/login", { password: $("passwordInput").value }); $("loginDialog").close(); await reload(); toast("Workspace unlocked", "You are connected to your private sandbox desk."); } catch (error) { $("loginMessage").textContent = error.message; } });
  try { const session = await api("/api/session"); if (!session.authenticated) { $("loginDialog").showModal(); return; } await reload(); }
  catch (error) { toast("Workspace unavailable", error.message, true); }
}
init();
