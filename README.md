# TransferGuard

### Payment Ops Incident Commander for Airwallex

**Resolve a delayed supplier transfer without paying twice.**

TransferGuard is a payment operations workspace built for the Airwallex Agentic Banking Hackathon, Starter Kit 03.

When a supplier says a payment never arrived while the original transfer is still uncertain, the dangerous response is to send the money again.

TransferGuard treats that situation as an incident.

It reconciles the original transfer, evaluates supplier evidence, prevents unsafe replacement payments, requires explicit human approval, and independently verifies the final Airwallex state before the incident can be marked resolved.

## The core idea

```text
Supplier says payment was not received
                    ↓
        Review supplier evidence
                    ↓
       Read Airwallex provider state
                    ↓
        Reconcile the original payment
                    ↓
       Original transfer is CANCELLED
                    ↓
          Human approves replacement
                    ↓
        Replacement transfer created
                    ↓
          Replacement reaches PAID
                    ↓
        Fresh Airwallex verification
                    ↓
                 RESOLVED
```

**The AI can interpret evidence. It cannot authorize money movement.**

The provider remains the source of truth for payment state.

---

## Why this matters

An uncertain supplier payment creates a dangerous decision:

**Send it again** and risk paying twice.

**Wait** and risk missing the supplier deadline.

TransferGuard introduces a controlled workflow between those two choices.

The system does not assume that a supplier message means the original payment failed.

It first reconciles the provider state.

A replacement becomes possible only after the original transfer has reached terminal `CANCELLED` and the operator explicitly approves the exact replacement terms.

---

## What the product actually does

### Airwallex sandbox integration

TransferGuard uses the Airwallex sandbox API for the payment workflow.

It can:

* Validate transfer details
* Create sandbox transfers
* Save and reconcile transfer request IDs
* Read transfer state directly from Airwallex
* Run the Airwallex sandbox simulator for the Track 03 scenario
* Verify both original and replacement transfers

There is no production payment mode.

Every transfer demonstrated in this project is an Airwallex sandbox record.

### Duplicate payment protection

The most important rule is simple:

> **Never create a replacement while the original payment is still uncertain.**

If a transfer request has an unclear result, TransferGuard reconciles the saved request ID instead of blindly sending another payment.

It also derives a payment fingerprint from the original payment terms and prevents an exact duplicate from creating another transfer.

The database enforces unique request IDs and duplicate payment constraints.

### Human controlled replacement

A replacement is never silently created.

The operator reviews the exact:

* Beneficiary
* Amount
* Currency
* Reference
* Payment terms

The replacement requires the explicit approval phrase:

```text
APPROVE EXACT REPLACEMENT
```

The approved terms are hashed and bound to the replacement operation.

### Independent final verification

Creating a replacement is not enough to resolve the incident.

TransferGuard performs a fresh provider read and requires:

```text
Original = CANCELLED
Replacement = PAID
```

Only then does the incident become `RESOLVED`.

Cancellation by itself is not treated as proof that the supplier received the money.

---

# AI architecture

TransferGuard uses Claude as a constrained evidence analysis component.

Claude extracts structured claims from supplier communications, such as:

```text
supplier_reports_not_received
supplier_reports_received
deadline_mentioned
reference_mentioned
```

Each claim must contain an exact quote from the source message.

The application verifies that the quote actually exists in the original evidence.

Claude can recommend:

```text
WAIT
REVIEW_REPLACEMENT
ESCALATE
```

It cannot:

* Establish Airwallex payment state
* Override provider state
* Authorize a replacement
* Create a transfer
* Decide that money was paid

The architecture is intentionally:

```text
AI reads
   ↓
Application validates
   ↓
Deterministic policy decides
   ↓
Human approves
   ↓
Airwallex moves money
   ↓
Airwallex confirms state
```

For a financial workflow, the model is given interpretation responsibility rather than payment authority.

---

# Track 03 workflow

The complete demonstrated scenario is:

```text
TRANSFER CREATED
        ↓
SENT
        ↓
SUPPLIER REPORTS NON RECEIPT
        ↓
RECONCILE ORIGINAL
        ↓
BANK RETURN
        ↓
CANCELLED
        ↓
REPLACEMENT PROPOSED
        ↓
HUMAN APPROVAL
        ↓
REPLACEMENT CREATED
        ↓
PAID
        ↓
INDEPENDENT VERIFICATION
        ↓
RESOLVED
```

The application also checks failure cases including:

* Exact duplicate original submission
* Replacement while the original is non terminal
* Stale evidence
* Approval replay
* Second replacement attempts
* Premature verification
* Uncertain transfer creation
* Request ID reconciliation

Eleven local tests currently pass.

---

# Evidence and audit trail

The Incident Desk puts the provider state, supplier evidence, and action history together.

The Activity Log records important events including:

* Transfer submission
* Airwallex validation
* Provider reconciliation
* Supplier evidence
* Evidence analysis
* Replacement proposal
* Approval
* Transfer creation
* State changes
* Verification
* Blocked duplicate attempts

Supplier evidence includes its source information and integrity fingerprint.

Synthetic supplier messages used for the hackathon scenario are clearly labelled as synthetic.

They are not presented as genuine supplier communications.

---

# Security

TransferGuard was designed to keep payment credentials and sensitive incident data away from the browser.

The application includes:

* Airwallex credentials kept server side
* Airwallex sandbox only enforcement
* Signed sessions
* Eight hour session expiry
* Scrypt password hashing
* HMAC SHA256 session signatures
* Timing safe signature comparison
* HttpOnly cookies
* SameSite Strict cookies
* Secure cookies in production
* Origin checking
* Login rate limiting
* AES 256 GCM encryption for sensitive SQLite fields
* Restrictive SQLite file permissions
* Evidence integrity fingerprints
* Hashed replacement approval terms
* Unique Airwallex request IDs
* Duplicate payment fingerprints

The system is deliberately conservative around money movement.

---

# Demo

## Track 03 demo video

[Watch the TransferGuard Track 03 demo](submission/TransferGuard_Track03_Demo.mp4)

The video demonstrates:

1. The supplier payment problem
2. Airwallex sandbox integration
3. The Incident Desk
4. Supplier evidence handling
5. Provider reconciliation
6. Duplicate payment protection
7. Human approval
8. Replacement payment
9. Independent verification
10. Final incident resolution

The video is under five minutes.

All transfers shown are Airwallex sandbox records.

Supplier messages shown in the scenario are synthetic and clearly labelled.

### Testing failure shown in the demo

During testing, an early exact repeat created an additional USD 10 sandbox transfer before the updated duplicate protection was active.

That transfer was cancelled in Airwallex sandbox and independently verified as `CANCELLED`.

The incident remained escalated and no replacement was issued.

After correcting the local process, the same exact repeat was blocked, the existing incident was reused, and no second transfer was sent.

The failure is included because it demonstrates the type of failure TransferGuard is specifically designed to prevent.

---

# Run locally

## Requirements

* Node.js 24 or newer
* Airwallex sandbox account
* Airwallex sandbox API credentials
* Claude API key

No package installation is required beyond Node.js.

Initialize the local environment:

```bash
npm run init-local
```

The setup script creates a private `.env` containing the operator password, session signing secret, and data encryption key.

The generated secrets are not printed by the script.

Start the application:

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Run the local test suite with:

```bash
npm test
```

The tests do not call Airwallex and do not create payment records.

For the complete Airwallex sandbox setup, permissions, funding, beneficiary configuration, and Track 03 workflow, see:

[Detailed setup and reviewer guide](docs/setup-guide.md)

---

# Environment

| Variable                          | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `APP_HOST`                        | Application bind address                  |
| `APP_PORT`                        | Application port                          |
| `APP_ORIGIN`                      | Browser origin used for mutation checks   |
| `APP_PASSWORD`                    | Local operator password                   |
| `APP_SESSION_SECRET`              | Session signing secret                    |
| `DATA_ENCRYPTION_KEY`             | AES 256 GCM encryption key                |
| `DATA_DIR`                        | SQLite data directory                     |
| `AIRWALLEX_CLIENT_ID`             | Airwallex sandbox Client ID               |
| `AIRWALLEX_API_KEY`               | Airwallex sandbox API key                 |
| `AIRWALLEX_BENEFICIARY_CLIENT_ID` | Optional beneficiary lookup Client ID     |
| `AIRWALLEX_BENEFICIARY_API_KEY`   | Optional beneficiary lookup API key       |
| `CLAUDE_API_KEY`                  | Claude API key                            |
| `CLAUDE_MODEL`                    | Claude model used for evidence extraction |

Airwallex credentials are accepted only for the fixed Airwallex sandbox API.

There is no production Airwallex mode.

The browser never receives Airwallex credentials.

---

# Airwallex sandbox workflow

The complete sandbox workflow is:

### 1. Create the original transfer

Create a low value sandbox transfer using an Airwallex sandbox beneficiary.

TransferGuard stores the request ID before calling the provider.

### 2. Reconcile uncertainty

If the creation response is unclear, TransferGuard uses the saved request ID to reconcile the original transfer.

It does not blindly create another payment.

### 3. Record supplier evidence

Record the supplier update used in the incident.

For the hackathon scenario, the synthetic source is clearly labelled.

Claude extracts the relevant evidence without receiving authority over payment execution.

### 4. Simulate the provider lifecycle

Use the Airwallex sandbox simulator to move the transfer through the Track 03 scenario.

The demonstrated path is:

```text
SENT
 ↓
FAILED
 ↓
CANCELLED
```

TransferGuard only allows replacement preparation after reading `CANCELLED` from Airwallex.

### 5. Approve the replacement

Review the exact replacement terms and enter:

```text
APPROVE EXACT REPLACEMENT
```

The approval is bound to the stored replacement terms.

### 6. Verify the replacement

Advance the replacement through the sandbox simulator until it reaches `PAID`.

TransferGuard then reads both provider records again.

Only:

```text
Original = CANCELLED
Replacement = PAID
```

can close the incident.

---

# Architecture

```text
                     ┌─────────────────────┐
                     │     Operator UI     │
                     │                     │
                     │   Incident Desk     │
                     │   Evidence Room     │
                     │   Activity Log      │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │     Node.js App     │
                     └──────────┬──────────┘
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
             ▼                  ▼                  ▼
      ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
      │   Claude    │    │   Policy    │    │   Security  │
      │  Evidence   │    │   Engine    │    │    Layer    │
      │  Analysis   │    │ Deterministic│    │   Sessions  │
      └─────────────┘    └──────┬──────┘    │ Encryption  │
                                │            └─────────────┘
                                ▼
                         ┌─────────────┐
                         │   SQLite    │
                         │  Incidents  │
                         │  Proposals  │
                         │   Events    │
                         └──────┬──────┘
                                │
                                ▼
                         ┌─────────────┐
                         │  Airwallex  │
                         │   Sandbox   │
                         │     API     │
                         └─────────────┘
```

---

# Technology

* Node.js
* JavaScript ES modules
* SQLite
* Airwallex REST API
* Claude API
* Browser based operations dashboard
* AES 256 GCM encryption
* Scrypt password hashing
* HMAC SHA256 signed sessions

---

# Operating limits

TransferGuard is a hackathon prototype for one operator and one Airwallex sandbox business.

It is not presented as a production multi tenant banking platform.

The current release uses one Node process and SQLite.

Production deployment would require additional infrastructure including:

* HTTPS
* Durable encrypted storage
* Backups
* Managed database infrastructure
* Shared rate limiting
* Multi replica coordination
* Proper tenant isolation
* Production security review
* Production payment controls

Production Airwallex credentials must not be configured.

---

# Project structure

```text
transferguard/
│
├── lib/
│   ├── airwallex.mjs
│   ├── claude.mjs
│   ├── policy.mjs
│   ├── security.mjs
│   └── store.mjs
│
├── public/
│   └── index.html
│
├── docs/
│   └── setup-guide.md
│
├── submission/
│   └── TransferGuard_Track03_Demo.mp4
│
└── package.json
```

---

# Hackathon

**Airwallex Agentic Banking Hackathon**

**Track:** Treasury & Ops

**Starter Kit:** 03 · Payment Ops Incident Commander

**Challenge:** Resolve a delayed supplier transfer without paying twice.

TransferGuard is submitted for the open **Founder’s Choice** and **Judges Choice** categories.

It does not claim eligibility for the Visa or Metal awards because those awards have additional tooling requirements.

---

# The principle behind TransferGuard

Financial automation should not mean giving an AI unrestricted authority over money.

TransferGuard uses a different model:

```text
Interpret with AI.
Decide with deterministic rules.
Approve with a human.
Execute through Airwallex.
Verify from the provider.
```

**When payment state is uncertain, the safest next payment is usually no payment until the original is reconciled.**
