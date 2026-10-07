import { airwallex } from "../lib/airwallex.mjs";

const requestId = process.argv[2];
if (!requestId) {
  console.error("Usage: node scripts/find-sandbox-transfer.mjs REQUEST_ID");
  process.exit(2);
}
try {
  const transfer = await airwallex.findByRequestId(requestId);
  console.log(JSON.stringify(transfer ? {
    found: true,
    id: transfer.id,
    status: transfer.status,
    amount: transfer.transfer_amount,
    currency: transfer.transfer_currency,
    reference: transfer.reference,
    requestId: transfer.request_id,
  } : { found: false, requestId }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ found: null, code: error.code || null, status: error.status || null, message: error.message }));
  process.exit(1);
}
