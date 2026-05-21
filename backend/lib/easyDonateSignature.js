const crypto = require('crypto');
const { secretsEqual } = require('./webhookSecret');

/**
 * EasyDonate Callback API: HMAC-SHA256 of "payment_id@cost@customer" with shop secret key.
 * @see https://docs.easydonate.ru/callback-api/http-request
 */
function verifyEasyDonateSignature(body, shopSecret) {
  const signature = body?.signature;
  if (!signature || !shopSecret) {
    return { ok: true, skipped: true };
  }

  const payment_id = body.payment_id;
  const cost = body.cost;
  if (payment_id == null || cost == null) {
    return { ok: false, skipped: false };
  }

  const customer = body.customer != null ? String(body.customer) : '';
  const payload = `${payment_id}@${cost}@${customer}`;
  const expected = crypto
    .createHmac('sha256', String(shopSecret))
    .update(payload)
    .digest('hex');

  const ok = secretsEqual(String(signature).toLowerCase(), expected.toLowerCase());
  return { ok, skipped: false };
}

module.exports = { verifyEasyDonateSignature };
