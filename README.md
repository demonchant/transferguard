# TransferGuard

TransferGuard is a payment operations desk for one operator and one Airwallex sandbox business. It helps resolve a delayed supplier transfer without creating a duplicate payout. Each installation belongs to its operator: there are no shared accounts, demo records, or sample mode. Every transfer in the workflow is created, changed, or read through the Airwallex sandbox API.

## Current state

The full Track 3 sandbox flow has been exercised through Airwallex. The original USD 10 transfer was reconciled by its saved request ID after an uncertain response, then moved through the Airwallex simulator to `SENT` and terminal `CANCELLED`. A clearly labeled synthetic scenario was recorded. After exact terms approval, one USD 10 replacement was created, advanced through the sandbox simulator, and independently read back as `PAID`; both records were verified and the incident is `RESOLVED`. Full workflow checks also covered exact duplicate original submission, nonterminal replacement block, stale evidence, approval replay, second replacement prevention, and premature verification. Eleven local tests pass. A clean reviewer setup with separate credentials remains. The event requires a working demo, a video under five minutes, and a repository link with setup instructions. The video and accessible repository remain. Claude and public hosting are optional for the published submission requirements. The official build period starts 25 October 2026 and project submissions are due 13 November; confirm whether work prepared before the build period may be submitted.

The project targets the open Founder’s Choice and Judges Choice categories. It does not claim eligibility for Visa or Metal awards. Track: Treasury & Ops, Starter Kit 03, Payment Ops Incident Commander.

## Run locally

Requirements: Node.js 24 or newer and an Airwallex sandbox account. No package install is needed.

1. Run `npm run init-local`. This creates a private `.env` with an operator password, session signing secret, and data encryption key. The script never prints those values.
2. Open `.env` on your own device. Save the generated `APP_PASSWORD` in your password manager so you can sign in. Do not paste secrets into chat or commit `.env`.
3. Add the Airwallex sandbox Client ID and API key described below. Add a Claude API key only if you want supplier message analysis. Claude is optional; the transfer workflow uses Airwallex status, deterministic policy, and your explicit approval.
4. In the Airwallex sandbox, select a beneficiary and check the wallet balance. Newly provisioned self serve sandbox accounts may include test balances and default beneficiaries. If the wallet is empty, use only Airwallex sandbox funding or simulation. No real money is needed. Starter Kit 03 requires a funded sandbox wallet.
5. Run `npm start` and open `http://127.0.0.1:3000`.

`npm test` runs local policy, encryption, session, storage, and duplicate payment fingerprint checks. These tests do not call a provider and do not create transaction records. The product itself has no mock provider or seeded transaction mode. See the [detailed setup and reviewer guide](docs/setup-guide.md) for sandbox permissions, funding, duplicate protection, and the complete Track 3 workflow.

The small floating helper is available throughout the interface. It opens on request, follows the latest action result, and links to transfer creation or the activity log. It does not trigger money movement or open itself over the user's work.

## Reviewer setup

There is no judge mode or public app link to log into. Reviewers run the same operator product locally with their own Airwallex sandbox business and sandbox API key. This keeps each reviewer's transfers, credentials, and incident history separate from the project owner's account. The event asks for a repository link and setup instructions; it does not list a hosted website as a submission item.

1. Clone the repository and install Node.js 24 or newer. The application has no third party runtime packages to install.
2. Run `npm run init-local` and keep the generated operator password and encryption key private.
3. Create or use an Airwallex sandbox business. Create a scoped sandbox API key for transfer read and write plus sandbox simulation write. Never use a production key.
4. Put that sandbox Client ID and API key in the local `.env` as `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY`. Add a funded sandbox wallet and beneficiary as described in the Airwallex setup steps below.
5. Run `npm start`, open `http://127.0.0.1:3000`, and sign in with the local operator password.
6. Use the normal interface to create a low value sandbox transfer, reconcile provider state, record the supplier statement used for the scenario, review exact replacement terms, approve, and verify both provider records. The simulator buttons call Airwallex sandbox endpoints and are labeled as simulations in the activity history.

The app has no central reviewer login and does not expose one participant's Airwallex account to another. The submitted repository and setup instructions are the runnable demo. A shared hosted login would require individual accounts, tenant isolation, and credential management, which this single operator build does not claim to provide.

## Environment values

| Name | Purpose | How to obtain it |
|---|---|---|
| `APP_HOST` | Bind address. Keep `127.0.0.1` for local use. | Set by the local setup script. For a container, use `0.0.0.0` behind a trusted HTTPS proxy. |
| `APP_PORT` | Local HTTP port. | Set by the local setup script or hosting platform. |
| `APP_ORIGIN` | Exact browser origin used for mutation origin checks. | Local default is `http://127.0.0.1:3000`. In deployment, set the public HTTPS origin with no path. |
| `APP_PASSWORD` | Single operator sign in for this installation. | Generated by `npm run init-local`; read it locally from `.env`. Each reviewer generates their own. |
| `APP_SESSION_SECRET` | Signs eight hour session cookies. | Generated by `npm run init-local`. Keep private. |
| `DATA_ENCRYPTION_KEY` | AES 256 GCM encryption key for sensitive SQLite fields. | Generated by `npm run init-local`. Back it up securely. Losing it makes encrypted records unreadable. |
| `DATA_DIR` | Durable directory for SQLite. | Optional. Defaults to `data`. Mount persistent encrypted storage in deployment. |
| `AIRWALLEX_CLIENT_ID` | This installation's sandbox API identity. | Sign in at [Airwallex Sandbox](https://sandbox.airwallex.com), then open Account, Developer, API keys. |
| `AIRWALLEX_API_KEY` | This installation's sandbox API secret. | Create a least privilege sandbox key in the same API keys area. Grant only the payout and sandbox simulation access needed for this demo. Never use production credentials. |
| `AIRWALLEX_BENEFICIARY_CLIENT_ID` | Optional Client ID for the dedicated beneficiary lookup script. | Use the Client ID paired with the read only sandbox key. If it is the same Client ID, leave blank. |
| `AIRWALLEX_BENEFICIARY_API_KEY` | Optional read only sandbox key for `scripts/list-beneficiaries.mjs`. | Create a scoped key with only Account permissions → Payouts → Beneficiaries → Read. |
| `CLAUDE_API_KEY` | Enables supplier message extraction. | Create an API key in the [Anthropic Console](https://console.anthropic.com/). Keep the key server side. |
| `CLAUDE_MODEL` | Anthropic model name. | Defaults to `claude-sonnet-4-6`; use a model enabled for your key. |

`AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY` are only accepted by a client whose API base URL is fixed to `https://api.sandbox.airwallex.com`. There is no production Airwallex mode. The browser never receives provider credentials.

## Live demo workflow

Use a low amount in the sandbox and only proceed after you have read the exact terms on screen.

1. Create a transfer using a real sandbox beneficiary, amount, currency, reason, and reference. The operator confirms that the exact terms should create a sandbox payout.
2. TransferGuard stores a request ID before it calls Airwallex. If the result is unclear, it searches that request ID and does not retry with a new payment.
3. Save a supplier update for a real workflow, or select the clearly labeled synthetic scenario source for the hackathon scenario. Synthetic text is never presented as a real supplier message. Claude may extract quoted claims, but cannot establish payment state or authorize money movement.
4. Refresh the transfer from Airwallex. For the demonstration, use Airwallex’s sandbox simulator to move it to `SENT`, then to `FAILED` with a bank return. Airwallex’s Kit 03 guide states that a failed transfer reaches terminal `CANCELLED`; the app only offers a replacement after it reads that state back.
5. Confirm the saved update reports non receipt. Review the replacement’s amount, currency, beneficiary, reference, and terms hash. Type `APPROVE EXACT REPLACEMENT` to authorize the one exact operation.
6. If creation times out, reconcile by the saved request ID. The UI blocks a second payment while the result is unclear.
7. Advance the replacement with the sandbox simulator, then verify by reading both transfers. The incident only resolves when the original is `CANCELLED` and the replacement is `PAID`.

The simulator is an explicit Airwallex sandbox action, not a fabricated local state. Do not present the simulator as a real bank event. Keep the visible sandbox label in the recording.

## Security and operating limits

- Airwallex credentials stay on the server. The client is hard coded to Airwallex sandbox.
- Workspace sessions are signed, HTTP only, same site cookies with an eight hour expiry. Production cookies require HTTPS.
- Mutations require the configured exact origin. Login attempts are rate limited per process.
- Sensitive transfer payloads, supplier messages, evidence, and event details are encrypted in SQLite with AES 256 GCM. SQLite runs with WAL and restrictive file permissions.
- Supplier message intake records the operator reported channel, received time, optional source reference, and a SHA 256 fingerprint with the encrypted message. This audit data does not independently prove who sent the message.
- No automatic retry sends a second payment. Provider ambiguity is a persisted state that requires request ID reconciliation. Exact duplicate original payment details return the existing incident and are blocked before another Airwallex create call.
- Replacement authorization is bound to stored terms with a SHA 256 digest and an exact phrase.
- This release uses a single Node process and SQLite. Production hosting must provide one application replica, durable encrypted disk, backups, HTTPS, and protected environment secrets. Login rate limits are process local. Add shared rate limiting and managed database storage before running multiple replicas or handling production funds.
- Never configure production Airwallex credentials. This is a hackathon sandbox application and does not claim regulated production payment readiness.

## Hackathon requirements and proof

The official [hackathon page](https://airwallex.hackerearth.com/) requests a working demo, a video walkthrough under five minutes, a repository link, and setup instructions. Kits 1 through 4 use the Airwallex sandbox and synthetic scenario data per the [Airwallex builder guide](https://airwallexdev.com/guide). Follow the [setup and reviewer guide](docs/setup-guide.md) to run the product with your own sandbox account. There is no shared judge password or public hosted login.
