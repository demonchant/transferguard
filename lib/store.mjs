import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createFieldCipher } from "./crypto.mjs";
import { originalPaymentFingerprint } from "./policy.mjs";

export function createStore(dataDir, encryptionKey) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dataDir, "transferguard.sqlite"));
  const fieldCipher = createFieldCipher(encryptionKey);
  try {
    chmodSync(join(dataDir, "transferguard.sqlite"), 0o600);
  } catch {}
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('sandbox')),
      status TEXT NOT NULL,
      original_transfer_id TEXT NOT NULL,
      original_request_id TEXT,
      original_json TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      deadline TEXT,
      supplier_message TEXT NOT NULL DEFAULT '',
      evidence_json TEXT,
      replacement_id TEXT,
      replacement_request_id TEXT,
      original_fingerprint TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'SUBMITTED', 'AMBIGUOUS', 'RECONCILED', 'REJECTED')),
      request_id TEXT NOT NULL UNIQUE,
      terms_json TEXT NOT NULL,
      terms_hash TEXT NOT NULL,
      evidence_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_proposal_per_incident
      ON proposals(incident_id) WHERE status IN ('PENDING', 'SUBMITTED', 'AMBIGUOUS');
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      incident_id TEXT NOT NULL REFERENCES incidents(id),
      kind TEXT NOT NULL,
      details_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('app', 'airwallex', 'claude')),
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_incident_per_original_transfer
      ON incidents(mode, original_transfer_id);
  `);
  try {
    db.exec("ALTER TABLE proposals ADD COLUMN evidence_hash TEXT NOT NULL DEFAULT ''");
  } catch {}
  try {
    db.exec("ALTER TABLE incidents ADD COLUMN original_fingerprint TEXT");
  } catch {}
  const fingerprintUpdate = db.prepare("UPDATE incidents SET original_fingerprint = ? WHERE id = ? AND original_fingerprint IS NULL");
  for (const row of db.prepare("SELECT id, original_json FROM incidents WHERE original_fingerprint IS NULL AND status <> 'CREATION_REJECTED'").all()) {
    try {
      const transfer = JSON.parse(fieldCipher.decrypt(row.original_json));
      fingerprintUpdate.run(originalPaymentFingerprint(transfer), row.id);
    } catch {}
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS one_incident_per_original_payment
    ON incidents(original_fingerprint) WHERE original_fingerprint IS NOT NULL AND status <> 'CREATION_REJECTED'`);

  const statements = {
    createIncident: db.prepare(`INSERT INTO incidents
      (id, mode, status, original_transfer_id, original_request_id, original_json, supplier_name, deadline, original_fingerprint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getIncident: db.prepare("SELECT * FROM incidents WHERE id = ?"),
    getDuplicateIncident: db.prepare("SELECT id FROM incidents WHERE original_fingerprint = ? AND status <> 'CREATION_REJECTED' ORDER BY created_at DESC LIMIT 1"),
    listIncidents: db.prepare("SELECT * FROM incidents ORDER BY updated_at DESC LIMIT 100"),
    updateIncident: db.prepare(`UPDATE incidents SET status = ?, original_transfer_id = ?, original_json = ?, original_request_id = ?,
      supplier_message = ?, evidence_json = ?, replacement_id = ?, replacement_request_id = ?,
      version = version + 1, updated_at = ? WHERE id = ? AND version = ?`),
    updateStatus: db.prepare("UPDATE incidents SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?"),
    createProposal: db.prepare(`INSERT INTO proposals (id, incident_id, status, request_id, terms_json, terms_hash, evidence_hash, created_at, updated_at)
      VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)`),
    getProposal: db.prepare("SELECT * FROM proposals WHERE id = ?"),
    proposalForIncident: db.prepare("SELECT * FROM proposals WHERE incident_id = ? ORDER BY created_at DESC LIMIT 1"),
    updateProposal: db.prepare("UPDATE proposals SET status = ?, updated_at = ? WHERE id = ?"),
    events: db.prepare("SELECT * FROM events WHERE incident_id = ? ORDER BY created_at ASC"),
    addEvent: db.prepare("INSERT INTO events (id, incident_id, kind, details_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
  };

  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function addEvent(incidentId, kind, details, source = "app") {
    statements.addEvent.run(randomUUID(), incidentId, kind, fieldCipher.encrypt(JSON.stringify(details)), source, new Date().toISOString());
  }

  function serializeIncident(row) {
    if (!row) return null;
    return {
      ...row,
      original_json: JSON.parse(fieldCipher.decrypt(row.original_json)),
      supplier_name: fieldCipher.decrypt(row.supplier_name),
      supplier_message: fieldCipher.decrypt(row.supplier_message) || "",
      evidence_json: row.evidence_json ? JSON.parse(fieldCipher.decrypt(row.evidence_json)) : null,
    };
  }

  return {
    createIncident(input) {
      const now = new Date().toISOString();
      statements.createIncident.run(input.id, input.mode, input.status, input.transferId, input.requestId || null,
        fieldCipher.encrypt(JSON.stringify(input.transfer)), fieldCipher.encrypt(input.supplierName), input.deadline || null,
        input.originalFingerprint || null, now, now);
      addEvent(input.id, "INCIDENT_CREATED", { mode: input.mode, transferId: input.transferId }, "airwallex");
      return this.getIncident(input.id);
    },
    getIncident(id) {
      return serializeIncident(statements.getIncident.get(id));
    },
    getDuplicateIncident(fingerprint) {
      const row = statements.getDuplicateIncident.get(fingerprint);
      return row ? this.getIncident(row.id) : null;
    },
    listIncidents() {
      return statements.listIncidents.all().map(serializeIncident);
    },
    updateIncident(id, expectedVersion, patch) {
      const row = this.getIncident(id);
      if (!row) return null;
      const result = statements.updateIncident.run(
        patch.status ?? row.status,
        patch.transferId ?? row.original_transfer_id,
        fieldCipher.encrypt(JSON.stringify(patch.transfer ?? row.original_json)),
        patch.requestId ?? row.original_request_id,
        fieldCipher.encrypt(patch.supplierMessage ?? row.supplier_message) ?? "",
        patch.evidence === undefined ? (row.evidence_json ? fieldCipher.encrypt(JSON.stringify(row.evidence_json)) : null) :
          fieldCipher.encrypt(JSON.stringify(patch.evidence)),
        patch.replacementId ?? row.replacement_id,
        patch.replacementRequestId ?? row.replacement_request_id,
        new Date().toISOString(), id, expectedVersion,
      );
      if (Number(result.changes) !== 1) throw new Error("INCIDENT_VERSION_CONFLICT");
      return this.getIncident(id);
    },
    setStatus(id, expectedVersion, status) {
      const result = statements.updateStatus.run(status, new Date().toISOString(), id, expectedVersion);
      if (Number(result.changes) !== 1) throw new Error("INCIDENT_VERSION_CONFLICT");
      return this.getIncident(id);
    },
    createProposal(input) {
      const now = new Date().toISOString();
      statements.createProposal.run(input.id, input.incidentId, input.requestId,
        fieldCipher.encrypt(JSON.stringify(input.terms)), input.hash, input.evidenceHash, now, now);
      addEvent(input.incidentId, "REPLACEMENT_PROPOSED", { proposalId: input.id, requestId: input.requestId, terms: input.terms });
      return this.getProposal(input.id);
    },
    getProposal(id) {
      const row = statements.getProposal.get(id);
      return row ? { ...row, terms_json: JSON.parse(fieldCipher.decrypt(row.terms_json)) } : null;
    },
    getProposalForIncident(incidentId) {
      const row = statements.proposalForIncident.get(incidentId);
      return row ? { ...row, terms_json: JSON.parse(fieldCipher.decrypt(row.terms_json)) } : null;
    },
    updateProposalStatus(id, status) {
      const proposal = this.getProposal(id);
      if (!proposal) return null;
      statements.updateProposal.run(status, new Date().toISOString(), id);
      addEvent(proposal.incident_id, "PROPOSAL_" + status, { proposalId: id, requestId: proposal.request_id });
      return this.getProposal(id);
    },
    addEvent,
    getEvents: (incidentId) => statements.events.all(incidentId).map((row) => ({
      ...row, details_json: JSON.parse(fieldCipher.decrypt(row.details_json)),
    })),
    transaction,
    close: () => db.close(),
  };
}
