# TransferGuard setup and reviewer guide

This guide is for the Airwallex Agentic Banking Hackathon, Treasury & Ops Starter Kit 03. Use a dedicated Airwallex **sandbox** business and sandbox keys only. Never use a production API key or real payment details.

## 1. Install the application

Requirements: Node.js 24 or newer. The app has no third party runtime packages.

In PowerShell:

```powershell
Set-Location "C:\path\to\transferguard"
node --version
npm run init-local
```

`npm run init-local` creates `.env` with a random local operator password, a session signing key, and a data encryption key. It does not print their values. Open `.env` on your own device and save `APP_PASSWORD` in your password manager. Do not paste it into chat or publish `.env`. If `.env` already exists, do not run the initializer again; preserve the existing keys and data.

## 2. Create Airwallex sandbox credentials

1. Sign in at [Airwallex Sandbox](https://sandbox.airwallex.com/) and open **Account → Developer → API keys**.
2. Create a scoped key for the sandbox business. Grant account level **Payouts → Transfers → Read and Write** and **Simulations → Write**. Select only the sandbox business. The app does not need production permissions.
3. To list beneficiaries, use a separate read only key with **Payouts → Beneficiaries → Read**, or add that read permission to the sandbox key if you prefer one key. Do not grant unrelated write permissions.
4. Copy the Client ID and API key into the private `.env` file as `AIRWALLEX_CLIENT_ID` and `AIRWALLEX_API_KEY`. Never expose the values in a screenshot, recording, public repository, or chat.

The optional Claude integration is not needed to run Track 3. The transfer policy, explicit approval, simulator, and final verification work without a Claude key.

## 3. Prepare a sandbox beneficiary and funds

- Use an existing sandbox beneficiary where possible. Run `node scripts/list-beneficiaries.mjs` to list beneficiaries with the optional read only credentials, or configure that script's separate key in `AIRWALLEX_BENEFICIARY_CLIENT_ID` and `AIRWALLEX_BENEFICIARY_API_KEY`.
- Set `AIRWALLEX_BENEFICIARY_CLIENT_ID` and `AIRWALLEX_BENEFICIARY_API_KEY` only when using a separate read only key. If omitted, the script uses the main sandbox credentials.
- Confirm the beneficiary supports USD LOCAL payments. Do not use real supplier bank details for the hackathon scenario.
- Kit 03 needs a funded sandbox wallet. Check `GET /api/v1/balances/current` and list Global Accounts with `GET /api/v1/global_accounts`. If there is no suitable USD LOCAL Global Account, create one. Airwallex's builder guide says deposit amounts use major units and the simulated balance is available immediately, although the response may say `PENDING`. A simulated deposit is test balance only, not a real bank deposit. Do not add real money.

For a direct REST setup, use the sandbox base URL `https://api.sandbox.airwallex.com` and authenticate first with `POST /api/v1/authentication/login` using `x-client-id` and `x-api-key`. Use the returned bearer token in `Authorization: Bearer <token>` for these calls. Keep the credential and token private. If you need a USD LOCAL Global Account, send:

```json
{
  "request_id": "<new UUID for this create operation>",
  "country_code": "US",
  "required_features": [{ "currency": "USD", "transfer_method": "LOCAL" }]
}
```

to `POST /api/v1/global_accounts/create`. Country code is the account country. Then simulate only enough funding for the demo. For a USD 10 LOCAL transfer, USD 25 leaves a small cushion; Airwallex's example uses 25000 major units, which is USD 25,000, so do not copy that larger example amount by accident. Send this to `POST /api/v1/simulation/deposit/create`:

```json
{
  "global_account_id": "<the USD account id>",
  "amount": 25,
  "payer_name": "Sandbox demo funding"
}
```

The deposit call has no currency field; funds arrive in the selected Global Account's currency. Re-read the sandbox balance before creating the transfer. If Airwallex returns an error, stop and inspect the account and permissions before retrying; do not create another deposit blindly.

## 4. Start and sign in

```powershell
npm start
```

Open `http://127.0.0.1:3000` and sign in with the local `APP_PASSWORD`. The password belongs to this local installation. Judges and reviewers should clone the repository, run `npm run init-local`, and create their own sandbox credentials; there is no shared judge password.

Run local checks separately when needed:

```powershell
npm test
```

These checks do not call Airwallex and do not create payment records.

## 5. Complete one Track 3 workflow in the interface

1. Choose **Create a live transfer**. Enter the supplier label, existing sandbox beneficiary ID, amount, currency, reference, and reason. Start with USD 10 LOCAL only if the sandbox wallet has enough test funds. Confirm the exact terms.
2. If the result is ambiguous, use **Reconcile request** on that incident. Do not submit the same invoice as a new payment while the first result is unclear. TransferGuard searches Airwallex with the saved request ID.
3. Refresh provider state. For the Track 3 scenario, use the labeled Airwallex sandbox simulator to move the original transfer to `SENT`, then simulate a bank return. Airwallex reports failed transfers as terminal `CANCELLED`; the simulator is not a real bank event.
4. Save the supplier update. For the hackathon scenario, choose **Synthetic hackathon scenario** and keep the first line explicit: `DEMO SCENARIO ONLY. No real supplier sent this message.` Enter when the scenario was prepared.
5. Prepare the replacement proposal only after the original reads `CANCELLED`. Review its amount, currency, beneficiary, reference, evidence fingerprint, and terms fingerprint. Confirm the scenario says the original payment was not received.
6. Type `APPROVE EXACT REPLACEMENT`. This approves only the exact displayed terms and saved evidence. The replacement receives a distinct request ID.
7. Use the sandbox simulator to move the replacement through `SENT` to `PAID`.
8. Choose **Verify both transfers**. The incident resolves only after fresh Airwallex reads confirm original `CANCELLED` and replacement `PAID`.

## 6. Duplicate payment behavior

- While a request is running, the interface disables its submit button.
- The server fingerprints the beneficiary, currency, amount, reference, and transfer method. Submitting those same payment details again returns the existing incident, records **Duplicate transfer attempt blocked**, and does not call Airwallex to create another original transfer.
- Repeating a still pending replacement proposal returns the same proposal. Once that replacement was submitted, another proposal is refused; reconcile or verify the existing replacement instead.
- An unclear create result must be reconciled with its original request ID. Never create a new request ID to retry an operation whose result is unknown.
- A deliberately different reference is treated as a different invoice. Operators must still check their invoice ledger before submitting a genuinely new payment.

The duplicate check is intentionally exact on beneficiary, currency, amount, reference, and transfer method. It prevents repeated clicks and exact resubmissions from creating the same original transfer twice. It cannot determine whether a changed reference is a new invoice or a typo, and it does not replace the operator's accounts payable ledger. A pending provider outcome remains a reconciliation task; do not change the reference to bypass that control.

## 7. Workflow behavior

The complete checked workflow covered sign in and configuration; original transfer creation; exact duplicate submission; blocked replacement while the original was not terminal; invalid state transitions; synthetic evidence changes invalidating an earlier proposal; a valid replacement proposal; duplicate pending proposal reuse; incorrect approval phrase; one approved replacement; approval replay; second replacement attempt; premature verification; then replacement `SENT`, `PAID`, and independent reads proving original `CANCELLED` plus replacement `PAID`.

Result: one original and one replacement were created in Airwallex sandbox; the exact repeat of the original did not create a second payment; the incident reached `RESOLVED` only after both provider records were checked. No production funds were used. This verifies the covered paths, not every network outage or concurrency timing; the app still fails closed when it cannot reconcile provider state.

## 8. What the interface records

The Activity Log shows user actions and Airwallex responses. The Evidence Room identifies synthetic scenario text. Sensitive transfer and evidence fields are encrypted in the local SQLite database. The browser never receives Airwallex credentials. The app is single operator and single process; it is not a multi tenant public banking service.

## 9. Demo and submission

The event asks for a working demo, a video under five minutes, and a repository link with setup instructions. A public product URL is not listed as a required item. Keep the sandbox label visible and clearly say that the supplier statement is synthetic scenario data and the failure transition is a sandbox simulation. Never present them as real supplier or bank evidence. The [Track 03 demo video](../submission/TransferGuard_Track03_Demo.mp4) is under five minutes and shows the sandbox workflow with synthetic scenario data clearly labeled.
