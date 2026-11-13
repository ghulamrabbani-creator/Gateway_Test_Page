// Turns raw PGW responses into plain-language "key insights".
// Rules come from Notes/Core: "3DS Authentication, Wallets and Chargeback Liability",
// "Card Scheme Decline Codes and Retry Policy", "PGW HPP Session and Order Lifecycle",
// and System_Refs/PGW/pgw-order-model-reference.md. Pure functions: safe on server and client.

const GOOD = 'good', BAD = 'bad', WARN = 'warn', INFO = 'info';

// ----- reference tables -----
const TRANS_STATUS = {
  Y: ['Fully authenticated', GOOD, 'Issuer verified the cardholder (frictionless or challenge passed).'],
  A: ['Attempted', GOOD, 'Issuer or card not taking part; the scheme stood in. Liability usually still shifts.'],
  N: ['Failed', BAD, 'Customer failed authentication. The payment should not be sent.'],
  R: ['Rejected by issuer', BAD, 'Issuer rejected the authentication.'],
  U: ['Unavailable', WARN, 'Authentication could not be performed (technical issue).'],
  C: ['Challenge required', INFO, 'Issuer asked for a challenge; final status comes after it completes.'],
  I: ['Information only', WARN, 'Data shared with the issuer; no authentication or liability shift.'],
};

const LIABILITY_ECI = { visa: ['05', '06'], mastercard: ['02', '01'], amex: ['05', '06'], mada: ['05', '06', '02', '01'] };

// DE 39 / network response codes → [plain meaning, retry advice, tone]
const DE39 = {
  '00': ['Approved', '', GOOD],
  '04': ['Pick up card', 'Do not retry. Card flagged by issuer.', BAD],
  '05': ['Do not honour (generic issuer decline)', 'Do not retry blindly; customer should contact their bank or use another card.', BAD],
  '12': ['Invalid transaction', 'Fix the request data before retrying.', BAD],
  '13': ['Invalid amount', 'Fix the amount before retrying.', BAD],
  '14': ['Invalid card number', 'Do not retry. Check the card number.', BAD],
  '15': ['Invalid issuer', 'Do not retry.', BAD],
  '30': ['Format error', 'Merchant/gateway data issue; fix before retrying.', BAD],
  '41': ['Lost card', 'Do not retry.', BAD],
  '43': ['Stolen card', 'Do not retry.', BAD],
  '46': ['Closed account', 'Do not retry.', BAD],
  '51': ['Insufficient funds / over limit', 'Retry only with a different amount or card.', BAD],
  '54': ['Expired card', 'Do not retry. Ask for updated card details.', BAD],
  '55': ['Invalid PIN', 'Not applicable online; check request.', BAD],
  '57': ['Not permitted to cardholder', 'Issuer blocks this type of transaction for the card. Do not retry.', BAD],
  '58': ['Not permitted to acquirer/terminal', 'MID or acquirer setup issue. Check MID configuration.', BAD],
  '59': ['Suspected fraud', 'Do not retry.', BAD],
  '61': ['Exceeds amount limit', 'Retry with a lower amount or another card.', BAD],
  '62': ['Restricted card', 'Do not retry.', BAD],
  '63': ['Security violation', 'Do not retry.', BAD],
  '65': ['Exceeds count limit, or 3DS soft decline', 'Resubmit with a fresh 3DS authentication, not a blind retry.', WARN],
  '78': ['Invalid / non-existent account', 'Do not retry.', BAD],
  '88': ['Cryptographic failure', 'Do not retry; check token/cryptogram data.', BAD],
  '91': ['Issuer or switch unavailable', 'System issue. Safe to retry shortly.', WARN],
  '92': ['Unable to route', 'System issue. Safe to retry shortly.', WARN],
  '96': ['System error', 'System issue. Safe to retry shortly.', WARN],
};

// Merchant Advice Codes (CyberSource field) → [meaning, tone]
const MAC = {
  visa: { '1': ['Issuer never approves: do not retry', BAD], '2': ['Cannot approve now: retry later', WARN], '3': ['Revalidate payment data before retry', WARN] },
  mastercard: {
    '01': ['New account information available: update card first', WARN], '02': ['Try again later', WARN], '03': ['Do not try again', BAD],
    '04': ['Token not supported', WARN], '21': ['Do not honour: do not retry', BAD], '22': ['Merchant does not qualify for product code', WARN],
    '24': ['Retry after 1 hour', WARN], '25': ['Retry after 24 hours', WARN], '26': ['Retry after 2 days', WARN], '27': ['Retry after 4 days', WARN],
    '28': ['Retry after 6 days', WARN], '29': ['Retry after 8 days', WARN], '30': ['Retry after 10 days', WARN], '40': ['Non-reloadable prepaid card', WARN],
    '41': ['Non-reloadable prepaid card', WARN], '42': ['Sanctions score over threshold: do not retry', BAD], '99': ['Do not try again', BAD],
  },
};

const VPAS = { '2': ['CAVV passed: full authentication', GOOD], '3': ['CAVV passed: attempt', GOOD], '1': ['CAVV failed validation', BAD], '4': ['CAVV failed validation (attempt)', BAD], B: ['CAVV passed, information only: no liability shift', WARN], '0': ['CAVV not validated', WARN] };
const ACI = { U: ['Qualified as fully authenticated e-commerce', GOOD], S: ['Qualified as attempted authentication', GOOD], W: ['Basic e-commerce, no authentication', WARN], N: ['Did not qualify for an e-commerce category', BAD] };

// Geidea normalised codes seen in production (PGW HPP Session and Order Lifecycle note) and in BESO
const GEIDEA_CODES = {
  '000/000': 'Success',
  '300/004': '3DS failed: the customer did not pass authentication (ACS returned N).',
  '100/060': 'Customer timed out on the 3DS screen; order was cancelled.',
  '110/013': 'Invalid billing address: an address block was sent with a missing field (e.g. empty street).',
  '110/019': 'Invalid "initiated by" value. MOTO (or MIT) is not enabled on this MID; ask Geidea Support to enable it for this environment.',
};

// ----- helpers -----
function findAll(obj, keyTest, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (keyTest(k, v)) out.push({ k, v });
    if (v && typeof v === 'object') findAll(v, keyTest, out, depth + 1);
  }
  return out;
}
const first = (obj, name) => findAll(obj, (k, v) => k.toLowerCase() === name.toLowerCase() && v !== null && v !== '')[0]?.v;
const brandOf = (o) => String(o?.paymentMethod?.brand || o?.paymentBrands?.[0] || '').toLowerCase();
const money = (n, c) => (n === null || n === undefined ? '—' : `${c || ''} ${Number(n).toFixed(2)}`.trim());

function txns(order) {
  return Array.isArray(order?.transactions) ? order.transactions : [];
}

export function explainDe39(code) {
  if (!code) return null;
  const c = String(code).padStart(2, '0').slice(-2);
  const hit = DE39[c];
  return hit ? { code: c, meaning: hit[0], advice: hit[1], tone: hit[2] } : { code: c, meaning: `Acquirer code ${c}`, advice: 'Not in the reference table; check scheme documentation.', tone: WARN };
}

// ----- main: PGW order object -----
export function orderInsights(order) {
  if (!order) return [];
  const out = [];
  const brand = brandOf(order);
  const list = txns(order);
  const authTx = [...list].reverse().find((t) => t.type === 'Authentication');
  const payTx = [...list].reverse().find((t) => t.type && t.type !== 'Authentication');
  const ccy = order.currency;

  // 1. Outcome
  const st = order.status, ds = order.detailedStatus;
  let tone = INFO, label = ds || st || 'Unknown';
  if (st === 'Success') tone = GOOD;
  if (st === 'Failed') tone = BAD;
  if (ds === 'Authorized') label = 'Authorized (funds held, not yet captured)';
  if (ds === 'Paid') label = 'Paid (authorized and captured)';
  if (ds === 'Voided' || ds === 'Cancelled') tone = INFO;
  if (st === 'InProgress') tone = WARN;
  out.push({ key: 'outcome', label: 'Outcome', value: label, tone, note: st && ds && st !== ds ? `Status ${st} / ${ds}` : undefined });

  // 2. Why it failed
  if (st === 'Failed' || (payTx && payTx.status === 'Failed')) {
    const t = payTx?.status === 'Failed' ? payTx : authTx?.status === 'Failed' ? authTx : payTx || authTx;
    const c = t?.codes || {};
    const key = `${c.responseCode}/${c.detailedResponseCode}`;
    const de = explainDe39(c.acquirerCode);
    let value = GEIDEA_CODES[key] || c.detailedResponseMessage || c.responseMessage || 'Failed (no reason returned)';
    let note = `Geidea ${key}${c.acquirerMessage ? ` · acquirer: ${c.acquirerMessage}` : ''}`;
    if (de && de.code !== '00') {
      value = `${de.meaning}`;
      note = `Acquirer code ${de.code}. ${de.advice} (${note})`;
    }
    if (ds === 'ClientAbandoned') value = 'Customer abandoned the payment page or the session was cancelled.';
    out.push({ key: 'decline', label: 'Decline reason', value, tone: de?.tone === WARN ? WARN : BAD, note });
  }

  // 3. Authentication + 4. liability
  const ad = authTx?.authenticationDetails;
  const initiated = String(order.initiatedBy || '').toLowerCase();
  if (ad) {
    const ts = TRANS_STATUS[ad.transactionStatus] || [`Status ${ad.transactionStatus || 'unknown'}`, WARN, ''];
    const eci = ad.acsEci || ad.eci;
    out.push({ key: 'auth', label: '3DS authentication', value: ts[0], tone: ts[1], note: [ts[2], eci ? `ECI ${eci}` : '', ad.protocolVersion ? `3DS ${ad.protocolVersion}` : ''].filter(Boolean).join(' · ') });
    const shift = eci && (LIABILITY_ECI[brand] || ['01', '02', '05', '06']).includes(String(eci).padStart(2, '0'));
    out.push({ key: 'liability', label: 'Fraud liability', value: shift ? 'Shifted to issuer' : 'Stays with merchant / acquirer', tone: shift ? GOOD : WARN, note: shift ? `ECI ${eci} on ${brand || 'card'} carries a liability shift (fraud chargebacks should not stand).` : `ECI ${eci || 'missing'} carries no liability shift for ${brand || 'this brand'}.` });
  } else if (!list.length) {
    out.push({ key: 'auth', label: '3DS authentication', value: 'Not in this response', tone: INFO, note: order.threeDSecureId ? `A 3DS record exists (${order.threeDSecureId}); fetch the full order to see the result.` : 'No transactions in this response.' });
  } else {
    let why = 'No 3DS was performed on this order.';
    if (initiated === 'merchant') why = 'Merchant-initiated (MIT): no customer present, so no 3DS. Expected.';
    if (initiated === 'moto') why = 'MOTO: card entered by the merchant, no 3DS. Expected.';
    out.push({ key: 'auth', label: '3DS authentication', value: 'Not performed', tone: initiated === 'merchant' || initiated === 'moto' ? INFO : WARN, note: why });
    out.push({ key: 'liability', label: 'Fraud liability', value: 'Stays with merchant / acquirer', tone: WARN, note: 'Without authentication (ECI 07 / 00) fraud disputes rely on compelling evidence.' });
  }

  // 5. Credential type: card, Geidea token, network token, wallet
  const pmType = String(order.paymentMethod?.type || '').toLowerCase();
  const ntMarkers = findAll(order, (k, v) =>
    (typeof v === 'string' && /SCHEME_TOKEN/i.test(v)) ||
    (k === 'paymentSolution' && ['014', '015'].includes(String(v))) ||
    ((k === 'tokenizedCard' || k === 'deviceSpecificNumber' || k === 'networkTokenUsed') && v));
  const isWallet = pmType && pmType !== 'card';
  let cred, credTone = INFO, credNote;
  if (isWallet) { cred = `Wallet (${order.paymentMethod.type})`; credNote = 'Device token + cryptogram; the ECI decides liability, not the cryptogram.'; }
  else if (ntMarkers.length) { cred = 'Scheme (network) token'; credTone = GOOD; credNote = `Marker found: ${ntMarkers[0].k}`; }
  else if (!list.length && !order.paymentMethod) { cred = 'Not in this response'; credNote = 'Fetch the full order by ID.'; }
  else if (order.isPayWithToken || order.isTokenPayment) { cred = 'Geidea token (card on file)'; credNote = 'PGW does not show whether a network token was sent to the scheme. Check on the processor side (direct MPGS/CYBS routes, phase 2).'; }
  else { cred = 'Card number (PAN)'; credNote = 'Customer entered the card on the payment page.'; }
  out.push({ key: 'credential', label: 'Processed as', value: cred, tone: credTone, note: credNote });

  // 6. Initiator / card on file
  const cofBits = [];
  if (initiated) cofBits.push(initiated === 'internet' ? 'Customer-initiated (CIT)' : initiated === 'merchant' ? 'Merchant-initiated (MIT)' : initiated === 'moto' ? 'MOTO' : order.initiatedBy);
  if (order.cardOnFile) cofBits.push('card saved for later (token requested)');
  if (order.tokenId) cofBits.push(`token ${order.tokenId}`);
  if (order.agreementId) cofBits.push(`agreement ${order.agreementId} (${order.agreementType || 'type n/a'})`);
  if (cofBits.length) out.push({ key: 'cof', label: 'Initiator / card on file', value: cofBits[0], tone: INFO, note: cofBits.slice(1).join(' · ') || undefined });

  // 7. Card
  const pm = order.paymentMethod || {};
  if (pm.maskedCardNumber || pm.brand) {
    out.push({ key: 'card', label: 'Card', value: `${pm.brand || ''} ${pm.maskedCardNumber || ''}`.trim(), tone: INFO, note: [pm.fundingType, pm.cardCategory, pm.issuingBank, pm.issuingCountry].filter(Boolean).join(' · ') || undefined });
  }

  // 8. Processor
  const pd = payTx || {};
  let proc = 'Not shown in the order';
  let procNote;
  if (pd.cybersourceDetails) { proc = 'CyberSource'; const c = pd.cybersourceDetails; procNote = [c.networkTransactionId && `NTID ${c.networkTransactionId}`, c.processorInfoResponseCode && `processor code ${c.processorInfoResponseCode}`].filter(Boolean).join(' · '); }
  else if (pd.postilionDetails) proc = 'Postilion';
  else if (first(order, 'acquirer') || /mpgs/i.test(JSON.stringify(pd))) { proc = 'MPGS'; const a = first(order, 'acquirer'); procNote = a?.id ? `acquirer link ${a.id}` : undefined; }
  out.push({ key: 'processor', label: 'Processor', value: proc, tone: INFO, note: [procNote, pd.rrn && `RRN ${pd.rrn}`, pd.authorizationCode && `auth code ${pd.authorizationCode}`].filter(Boolean).join(' · ') || undefined });

  // 9. Visa verdicts and Merchant Advice Code, when present anywhere
  const vpas = first(order, 'vpasResponse') ?? first(order, 'consumerAuthenticationResponseCode');
  if (vpas !== undefined && VPAS[String(vpas)]) out.push({ key: 'vpas', label: 'Visa CAVV check', value: VPAS[String(vpas)][0], tone: VPAS[String(vpas)][1] });
  const aci = first(order, 'returnAci');
  if (aci && ACI[aci]) out.push({ key: 'aci', label: 'Visa category (ACI)', value: ACI[aci][0], tone: ACI[aci][1] });
  const mac = first(order, 'merchantAdviceCode');
  if (mac) {
    const t = (MAC[brand] || {})[String(mac)] || (MAC.mastercard[String(mac).padStart(2, '0')]) || [`Code ${mac}`, WARN];
    out.push({ key: 'mac', label: 'Merchant advice (retry rule)', value: t[0], tone: t[1], note: 'Retrying against a "do not retry" code can draw scheme penalties.' });
  }

  // 10. Money
  out.push({ key: 'amounts', label: 'Amounts', value: `Authorized ${money(order.totalAuthorizedAmount, ccy)}`, tone: INFO, note: `Captured ${money(order.totalCapturedAmount, ccy)} · Refunded ${money(order.totalRefundedAmount, ccy)}` });

  // 10b. Settlement currency differs from the transaction currency (MID set to settle in another currency)
  const mc = order.multiCurrency;
  if (mc?.settleCurrency && mc.settleCurrency !== (mc.authCurrency || ccy)) {
    out.push({ key: 'settle', label: 'Settlement', value: `Settles in ${mc.settleCurrency} (${money(mc.settleAmount, mc.settleCurrency)})`, tone: INFO, note: `Rate ${mc.exchangeRate} from ${mc.authCurrency || ccy}${mc.exchangeFeeAmount ? ` · FX fee ${mc.exchangeFeeAmount}` : ''}. Customer was charged in ${mc.authCurrency || ccy}.` });
  }

  // 10c. Summary record (fetch by reference) — details missing
  if (!list.length && st === 'Success') out.push({ key: 'summary', label: 'Data', value: 'Summary record only', tone: WARN, note: 'This response has no transactions, so 3DS, card and processor details are missing. Fetch by order ID for the full order.' });

  // 11. Known oddities worth flagging
  if (order.gatewayDecision === 'Reject' && st === 'Success') out.push({ key: 'gd', label: 'Watch', value: 'gatewayDecision "Reject" on a successful order', tone: INFO, note: 'Known PGW pattern, not yet explained (open question in the PGW note).' });
  if (order.isTest === false) out.push({ key: 'live', label: 'Mode', value: 'Live order (isTest false)', tone: WARN });

  return out;
}

// ----- any API response (session, capture, refund, errors) -----
export function responseInsights({ action, status, res_body: body, error }) {
  if (error) return [{ key: 'net', label: 'Network', value: error, tone: BAD, note: 'The call did not reach Geidea or timed out.' }];
  const out = [];
  const order = body?.order && typeof body.order === 'object' ? body.order : null;
  const rc = body?.responseCode, dc = body?.detailedResponseCode;
  if (status === 401 || status === 403) out.push({ key: 'http', label: 'Rejected', value: 'Authentication to Geidea failed', tone: BAD, note: 'Check the merchant public key and API password for this environment.' });
  else if (status >= 500) out.push({ key: 'http', label: 'Geidea error', value: `HTTP ${status}`, tone: BAD, note: 'Server-side error at Geidea. Retry, then raise with PGW engineering with the correlation ID.' });
  if (rc) {
    const key = `${rc}/${dc}`;
    const ok = rc === '000';
    out.push({ key: 'code', label: 'Result', value: GEIDEA_CODES[key] || body.detailedResponseMessage || body.responseMessage || key, tone: ok ? GOOD : BAD, note: `Geidea ${key}` });
    if (!ok && /signature/i.test(`${body.detailedResponseMessage} ${body.responseMessage}`)) out.push({ key: 'sig', label: 'Hint', value: 'Signature mismatch', tone: WARN, note: 'Check the API password, the 2-decimal amount and the timestamp (MM/DD/YYYY hh:mm:ss AM/PM).' });
  }
  if (body?.errors && typeof body.errors === 'object') {
    const fields = Object.entries(body.errors).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join(' · ');
    out.push({ key: 'validation', label: 'Validation errors', value: fields.slice(0, 300), tone: BAD });
  }
  const session = body?.session;
  if (session?.id) out.push({ key: 'session', label: 'Session', value: `Created (${session.id})`, tone: GOOD, note: `${session.expiryDate ? `Expires ${session.expiryDate}. ` : ''}Observed TTL is about 12 minutes; PGW does not currently block payments on an expired session.` });
  if (order) out.push(...orderInsights(order));
  if (!out.length) out.push({ key: 'http', label: 'HTTP', value: `${status}`, tone: status >= 200 && status < 300 ? GOOD : WARN });
  return out;
}

export const TONES = { GOOD, BAD, WARN, INFO };
