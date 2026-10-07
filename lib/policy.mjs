import { createHash } from "node:crypto";

const TERMINAL = new Set(["PAID", "CANCELLED"]);

export function originalPaymentFingerprint(transfer) {
  const amount = Number(transfer?.transfer_amount);
  if (!transfer?.beneficiary_id || !Number.isFinite(amount) || amount <= 0 ||
      !/^[A-Z]{3}$/i.test(String(transfer?.transfer_currency || "")) || !transfer?.reference) {
    throw new Error("A payment fingerprint requires beneficiary, amount, currency, and reference.");
  }
  const identity = [
    String(transfer.beneficiary_id).trim(),
    String(transfer.transfer_currency).trim().toUpperCase(),
    amount.toString(),
    String(transfer.reference).trim().toLowerCase(),
    String(transfer.transfer_method || "LOCAL").trim().toUpperCase(),
  ];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function decisionFor(transfer, hasReplacement = false) {
  const status = String(transfer?.status || "UNKNOWN").toUpperCase();
  if (hasReplacement) return { action: "RECONCILE", reason: "A replacement already exists; verify both transfers before taking another action." };
  if (status === "PAID") return { action: "RESOLVED", reason: "Airwallex reports the original transfer as paid." };
  if (!TERMINAL.has(status)) {
    return { action: "WAIT", reason: "The original transfer is not in a verified terminal state. A replacement is blocked." };
  }
  if (status === "CANCELLED") {
    return {
      action: "REPLACEMENT_REQUIRES_APPROVAL",
      reason: "Airwallex reports a terminal cancelled state. Review the failure details and supplier evidence, then explicitly approve exact replacement terms.",
    };
  }
  return { action: "ESCALATE", reason: "The transfer status is not recognized by the safe policy." };
}

export function isTerminal(transfer) {
  return TERMINAL.has(String(transfer?.status || "").toUpperCase());
}

export function bothTransfersVerified(original, replacement) {
  return String(original?.status || "").toUpperCase() === "CANCELLED" &&
    String(replacement?.status || "").toUpperCase() === "PAID";
}

export function replacementPayload(original, requestId, incidentId) {
  if (!original?.beneficiary_id) throw new Error("A replacement requires a stored Airwallex beneficiary ID.");
  if (!original?.transfer_amount || !/^[A-Z]{3}$/.test(String(original.transfer_currency || ""))) {
    throw new Error("The original transfer is missing an amount or currency.");
  }
  return {
    beneficiary_id: original.beneficiary_id,
    reason: original.reason || "goods_purchased",
    reference: ("TG" + incidentId.replaceAll("-", "").slice(0, 12)).slice(0, 32),
    request_id: requestId,
    source_currency: original.transfer_currency,
    transfer_currency: original.transfer_currency,
    transfer_amount: original.transfer_amount,
    ...(original.transfer_method ? { transfer_method: original.transfer_method } : {}),
  };
}
