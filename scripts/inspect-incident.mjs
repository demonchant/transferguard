import { config } from "../lib/config.mjs";
import { createStore } from "../lib/store.mjs";

const incidentId = process.argv[2];
if (!incidentId) {
  const store = createStore(config.dataDir, config.dataEncryptionKey);
  try {
    console.log(JSON.stringify(store.listIncidents().map((incident) => {
      const sourceEvent = store.getEvents(incident.id).reverse().find((event) => event.kind === "SUPPLIER_MESSAGE_ADDED");
      return {
        id: incident.id,
        status: incident.status,
        transferId: incident.original_transfer_id,
        reference: incident.original_json?.reference,
        amount: incident.original_json?.transfer_amount,
        currency: incident.original_json?.transfer_currency,
        evidenceSource: sourceEvent?.details_json?.source || null,
      };
    }), null, 2));
  } finally {
    store.close();
  }
  process.exit(0);
}
const store = createStore(config.dataDir, config.dataEncryptionKey);
try {
  const incident = store.getIncident(incidentId);
  const sourceEvent = incident ? store.getEvents(incident.id).reverse().find((event) => event.kind === "SUPPLIER_MESSAGE_ADDED") : null;
  console.log(JSON.stringify(incident ? {
    id: incident.id,
    status: incident.status,
    originalTransferId: incident.original_transfer_id,
    requestId: incident.original_request_id,
    replacementId: incident.replacement_id,
    replacementRequestId: incident.replacement_request_id,
    version: incident.version,
    evidenceSource: sourceEvent?.details_json?.source || null,
    evidenceRecordedAt: sourceEvent?.details_json?.receivedAt || sourceEvent?.details_json?.preparedAt || null,
  } : null, null, 2));
} finally {
  store.close();
}
