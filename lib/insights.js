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

// R24: Decision Manager / risk result as PGW passes it on a transaction (riskResponse or cybersourceDetails).
// Shapes vary, so look for the usual CYBS field names anywhere inside.
function riskDecision(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const hits = {};
  findAll(obj, (k, v) => {
    if (v == null || typeof v === 'object') return false;
    const key = String(k).toLowerCase();
    if (!hits.decision && (key === 'decision' || key === 'earlydecision' || key === 'riskdecision' || (key === 'status' && /REJECT|REVIEW|ACCEPT|DECLINE/i.test(String(v))))) hits.decision = String(v);
    if (!hits.reason && (key === 'reason' || key === 'reasoncode' || key === 'errorreason')) hits.reason = String(v);
    if (hits.score == null && (key === 'result' || key === 'score') && /^\d+$/.test(String(v))) hits.score = String(v);
    if (!hits.rules && key === 'rules') hits.rules = String(v);
    return false;
  });
  return hits.decision ? hits : null;
}

// ----- main: PGW order object -----
export function orderInsights(order) {
  if (!order) return [];
  const out = [];
  const brand = brandOf(order);
  const list = txns(order);
  const authTx = [...list].reverse().find((t) => t.type === 'Authentication');
  const payTx = list.find((t) => ['Pay', 'Authorize', 'PreAuthorize', 'Authorization'].includes(t.type)) || [...list].reverse().find((t) => t.type && t.type !== 'Authentication');
  const lastTx = [...list].reverse().find((t) => t.type && t.type !== 'Authentication');
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
  if (st === 'Failed' || (lastTx && lastTx.status === 'Failed')) {
    const t = lastTx?.status === 'Failed' ? lastTx : payTx?.status === 'Failed' ? payTx : authTx?.status === 'Failed' ? authTx : lastTx || authTx;
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

  // 2b. R24: where it stopped — PGW itself, risk / Decision Manager, or the acquirer / issuer
  if (st === 'Failed' || (lastTx && lastTx.status === 'Failed')) {
    const t = [...list].reverse().find((x) => x.status === 'Failed' && x.type !== 'Authentication') || lastTx;
    const c = t?.codes || {};
    const risk = t?.riskResponse || order.riskResponse || null;
    const cs = t?.cybersourceDetails || null;
    const dm = riskDecision(risk) || riskDecision(cs);
    const provider = t?.providerType || '';
    const ar = t?.authorizationResponse || {};
    const reachedAcquirer = !!(c.acquirerCode || ar.responseCode || ar.transactionIdentifier || t?.authorizationCode || t?.rrn);
    let value, note, tone = BAD;
    if (dm && /REJECT|DECLINE|REVIEW/i.test(dm.decision)) {
      value = `Decision Manager: ${dm.decision}`;
      note = [dm.reason && `reason ${dm.reason}`, dm.score != null && `score ${dm.score}`, dm.rules && `rules ${dm.rules}`].filter(Boolean).join(' · ') || 'Fraud screening rejected the payment before or after authorization.';
    } else if (order.isHighRisk || order.highRiskDetails) {
      value = 'Flagged as high risk by PGW';
      note = typeof order.highRiskDetails === 'string' ? order.highRiskDetails : order.highRiskDetails ? JSON.stringify(order.highRiskDetails).slice(0, 200) : 'isHighRisk is true on the order.';
    } else if (reachedAcquirer) {
      value = 'Declined by the acquirer / issuer';
      note = `${provider ? `${provider} · ` : ''}acquirer code ${c.acquirerCode || ar.responseCode || '—'}${c.acquirerMessage ? ` (${c.acquirerMessage})` : ''}.`;
    } else {
      value = 'Stopped inside PGW: never reached the acquirer';
      tone = WARN;
      note = `No acquirer code, authorization response or RRN on the ${t?.type || 'payment'} transaction${provider ? ` (provider ${provider})` : ''}, and no risk / Decision Manager result. Geidea ${c.responseCode || '—'}/${c.detailedResponseCode || '—'}. Look the order up on MPGS: if only AUTHENTICATION is there, PGW failed before sending the payment.`;
    }
    out.push({ key: 'stopped', label: 'Where it stopped', value, tone, note });
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
  else if (order.isPayWithToken || order.isTokenPayment) { cred = 'Geidea token (card on file)'; credNote = 'PGW does not show whether a network token was sent to the scheme. On Saved cards, use "Check network token on MPGS" to look behind the token.'; }
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
  if (pd.providerType) {
    proc = pd.providerType === 'MPGS' ? 'MPGS' : pd.providerType === 'CyberSource' || pd.providerType === 'CYBS' ? 'CyberSource' : pd.providerType;
    const ar = pd.authorizationResponse || {};
    procNote = [pd.acquirer?.id && `acquirer link ${pd.acquirer.id}`, ar.financialNetworkCode && `network ${ar.financialNetworkCode}`, pd.acquirer?.transactionId && `trace ${pd.acquirer.transactionId}`, pd.cybersourceDetails?.networkTransactionId && `NTID ${pd.cybersourceDetails.networkTransactionId}`].filter(Boolean).join(' · ');
  } else if (pd.cybersourceDetails) { proc = 'CyberSource'; const c = pd.cybersourceDetails; procNote = [c.networkTransactionId && `NTID ${c.networkTransactionId}`, c.processorInfoResponseCode && `processor code ${c.processorInfoResponseCode}`].filter(Boolean).join(' · '); }
  else if (pd.postilionDetails) proc = 'Postilion';
  else if (first(order, 'acquirer') || /mpgs/i.test(JSON.stringify(pd))) { proc = 'MPGS'; const a = first(order, 'acquirer'); procNote = a?.id ? `acquirer link ${a.id}` : undefined; }
  out.push({ key: 'processor', label: 'Processor', value: proc, tone: INFO, note: [procNote, pd.rrn && `RRN ${pd.rrn}`, pd.authorizationCode && `auth code ${pd.authorizationCode}`].filter(Boolean).join(' · ') || undefined });

  // 8b. CVV check (MPGS authorizationResponse.cardSecurityCodeError)
  const CVV = { M: ['CVV matched', GOOD], N: ['CVV did not match', BAD], P: ['CVV not processed', WARN], S: ['CVV should be present but was not', WARN], U: ['Issuer not certified for CVV / unavailable', WARN] };
  const cvv = pd.authorizationResponse?.cardSecurityCodeError;
  if (cvv && CVV[cvv]) out.push({ key: 'cvv', label: 'CVV check', value: CVV[cvv][0], tone: CVV[cvv][1] });

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


// ----- direct MPGS responses (transaction, retrieve order, session, token) -----
// Field meanings from the UAE POC runs (v80, MID 20100000101) and Mastercard Gateway API reference.
const MPGS_GW = {
  APPROVED: ['Approved', GOOD], APPROVED_AUTO: ['Approved (auto)', GOOD], APPROVED_PENDING_SETTLEMENT: ['Approved, pending settlement', GOOD],
  DECLINED: ['Declined by issuer', BAD], DECLINED_AVS: ['Declined: address check', BAD], DECLINED_CSC: ['Declined: CVV check', BAD], DECLINED_AVS_CSC: ['Declined: address + CVV', BAD],
  DECLINED_PAYMENT_PLAN: ['Declined: payment plan', BAD], DECLINED_DO_NOT_CONTACT: ['Declined: do not contact (do not retry)', BAD],
  INSUFFICIENT_FUNDS: ['Insufficient funds', BAD], EXPIRED_CARD: ['Expired card', BAD], LOCK_FAILURE: ['Order locked, try again', WARN],
  TIMED_OUT: ['Timed out at the acquirer', WARN], ACQUIRER_SYSTEM_ERROR: ['Acquirer system error', WARN], SYSTEM_ERROR: ['Gateway system error', WARN],
  REFERRED: ['Referred: call the issuer', WARN], BLOCKED: ['Blocked by gateway risk rules', BAD], NOT_SUPPORTED: ['Not supported for this merchant/card', BAD],
  UNSPECIFIED_FAILURE: ['Failed (unspecified)', BAD], ABORTED: ['Aborted', BAD], CANCELLED: ['Cancelled', INFO], NOT_ENROLLED_3D_SECURE: ['Card not enrolled in 3DS', WARN],
  AUTHENTICATION_IN_PROGRESS: ['Authentication in progress', INFO], PENDING: ['Pending', WARN], BASIC_VERIFICATION_SUCCESSFUL: ['Card verified (basic)', GOOD],
  EXTERNAL_VERIFICATION_SUCCESSFUL: ['Card verified', GOOD], EXTERNAL_VERIFICATION_DECLINED: ['Verification declined', BAD],
};
const MPGS_AUTH = {
  AUTHENTICATION_SUCCESSFUL: ['Fully authenticated', GOOD], AUTHENTICATION_ATTEMPTED: ['Attempted (scheme stood in)', GOOD], AUTHENTICATION_FAILED: ['Failed', BAD],
  AUTHENTICATION_PENDING: ['Challenge pending', INFO], AUTHENTICATION_AVAILABLE: ['Available, not yet run', INFO], AUTHENTICATION_NOT_IN_EFFECT: ['Not performed', WARN],
  AUTHENTICATION_NOT_SUPPORTED: ['Not supported for this card', WARN], AUTHENTICATION_UNAVAILABLE: ['Unavailable (technical)', WARN], AUTHENTICATION_REJECTED: ['Rejected by issuer', BAD],
  AUTHENTICATION_EXEMPT: ['Exempt', INFO], AUTHENTICATION_INITIATED: ['Initiated', INFO], AUTHENTICATION_UNSUCCESSFUL: ['Unsuccessful', BAD],
};
const CSC_GW = { MATCH: ['CVV matched', GOOD], NO_MATCH: ['CVV did not match', BAD], NOT_PROCESSED: ['CVV not processed', WARN], NOT_PRESENT: ['No CVV sent', INFO], NOT_SUPPORTED: ['Issuer does not check CVV', WARN] };
const REC = { PROCEED: ['Proceed', GOOD], DO_NOT_PROCEED: ['Do not proceed', BAD], RESUBMIT_WITH_ALTERNATIVE_PAYMENT_DETAILS: ['Ask for another card', WARN], DO_NOT_PROCEED_ABANDON_ORDER: ['Abandon the order', BAD] };

export function isMpgsBody(b) {
  if (!b || typeof b !== 'object') return false;
  return ['SUCCESS', 'FAILURE', 'PENDING', 'ERROR', 'UNKNOWN'].includes(b.result) && !('responseCode' in b) ||
    (b.merchant && (b.transaction || b.order || b.sourceOfFunds)) || (b.result && b.session?.updateStatus) || !!b.repositoryId;
}

// One MPGS transaction or retrieve-order body → insights.
export function mpgsInsights(b) {
  if (!b) return [];
  const out = [];
  if (b.result === 'ERROR' || b.error) {
    const e = b.error || {};
    out.push({ key: 'code', label: 'Result', value: e.explanation || e.cause || 'Error', tone: BAD, note: [e.cause, e.field && `field ${e.field}`, e.validationType].filter(Boolean).join(' · ') || undefined });
    if (/credentials|authentication failed|merchant/i.test(String(e.explanation)) && e.cause === 'REQUEST_REJECTED') out.push({ key: 'hint', label: 'Hint', value: 'Check the MPGS merchant ID and API password in Admin', tone: WARN });
    return out;
  }
  // Retrieve order: { id, status, transaction: [...] } — read the latest financial transaction
  const isOrder = Array.isArray(b.transaction);
  const list = isOrder ? b.transaction : [];
  const fin = isOrder ? [...list].reverse().find((t) => !/AUTHENTICATION/.test(t.transaction?.type || '')) : b;
  const authT = isOrder ? [...list].reverse().find((t) => /AUTHENTICATION/.test(t.transaction?.type || '')) : null;
  const order = isOrder ? b : b.order || {};
  const t = fin || {};

  if (b.session?.id && !b.order) out.push({ key: 'session', label: 'Session', value: `MPGS session ${b.session.id}`, tone: GOOD, note: b.session.updateStatus ? `Update status ${b.session.updateStatus}` : undefined });
  if (b.repositoryId || (b.token && !b.order)) {
    out.push({ key: 'token', label: 'MPGS token', value: b.token || '—', tone: b.status === 'VALID' ? GOOD : WARN, note: [b.status && `status ${b.status}`, b.repositoryId && `repository ${b.repositoryId}`, b.verificationStrategy && `verification ${b.verificationStrategy}`].filter(Boolean).join(' · ') });
    const st = b.schemeToken;
    out.push(st?.provider
      ? { key: 'credential', label: 'Network token', value: `Yes: ${st.provider === 'VTS' ? 'Visa (VTS)' : st.provider === 'MDES' ? 'Mastercard (MDES)' : st.provider}`, tone: GOOD, note: st.status ? `Status ${st.status}` : 'v80 shows the provider only, no status. A payment returning SCHEME_TOKEN is the proof it is used.' }
      : { key: 'credential', label: 'Network token', value: 'Not provisioned (yet)', tone: WARN, note: 'Provisioning is asynchronous; check again in a few minutes. If it never appears, the repository may not have NT on.' });
  }

  if (order.status || t.response) {
    const gc = t.response?.gatewayCode;
    const g = MPGS_GW[gc] || [gc || order.status, t.result === 'SUCCESS' ? GOOD : t.result ? BAD : INFO];
    const label = order.status === 'CAPTURED' ? 'Paid (captured)' : order.status === 'AUTHORIZED' ? 'Authorized (funds held, not yet captured)' : order.status || g[0];
    out.push({ key: 'outcome', label: 'Outcome', value: label, tone: g[1], note: [gc && `gatewayCode ${gc}`, t.transaction?.type && `last ${t.transaction.type.toLowerCase()}`, order.id && `MPGS order ${order.id}`].filter(Boolean).join(' · ') || undefined });
    const ac = t.response?.acquirerCode;
    if (ac && ac !== '00' && t.result !== 'SUCCESS') {
      const de = explainDe39(ac);
      out.push({ key: 'decline', label: 'Decline reason', value: de.meaning, tone: de.tone, note: `Acquirer code ${de.code}. ${de.advice}${t.response?.acquirerMessage ? ` (${t.response.acquirerMessage})` : ''}` });
    }
  }

  // 3DS
  const auth = (authT || t).authentication || order.authentication || {};
  const authStatus = t.transaction?.authenticationStatus || order.authenticationStatus || (authT || {}).transaction?.authenticationStatus;
  const ts = auth['3ds2']?.transactionStatus;
  const eci = auth['3ds']?.acsEci;
  const brand = String(t.sourceOfFunds?.provided?.card?.brand || order.sourceOfFunds?.provided?.card?.brand || '').toLowerCase();
  if (authStatus || ts) {
    const a = ts && TRANS_STATUS[ts] ? [TRANS_STATUS[ts][0], TRANS_STATUS[ts][1]] : MPGS_AUTH[authStatus] || [authStatus, INFO];
    out.push({ key: 'auth', label: '3DS authentication', value: a[0], tone: a[1], note: [authStatus, eci && `ECI ${eci}`, auth['3ds2']?.protocolVersion && `3DS ${auth['3ds2'].protocolVersion}`, auth.version].filter(Boolean).join(' · ') });
    if (t.transaction?.type && !/AUTHENTICATION/.test(t.transaction.type)) {
      const shift = eci && (LIABILITY_ECI[brand] || ['01', '02', '05', '06']).includes(String(eci).padStart(2, '0'));
      out.push({ key: 'liability', label: 'Fraud liability', value: shift ? 'Shifted to issuer' : 'Stays with merchant / acquirer', tone: shift ? GOOD : WARN, note: shift ? `ECI ${eci} on ${brand || 'card'}.` : `ECI ${eci || 'missing'}: no liability shift.` });
    }
  }
  const rec = t.response?.gatewayRecommendation;
  if (rec && REC[rec]) out.push({ key: 'rec', label: 'Gateway recommendation', value: REC[rec][0], tone: REC[rec][1], note: rec });

  // Credential: SCHEME_TOKEN is the proof a network token went to the scheme
  const sof = t.sourceOfFunds || order.sourceOfFunds;
  if (sof && (t.transaction?.type || isOrder) && !b.repositoryId) {
    const c = sof.provided?.card || {};
    let v = 'Card number (PAN)', tone = INFO, note = 'Card from the Hosted Session.';
    if (sof.type === 'SCHEME_TOKEN') { v = 'Scheme (network) token'; tone = GOOD; note = [c.deviceSpecificNumber && `token PAN ${c.deviceSpecificNumber}`, c.deviceSpecificExpiry && `token expiry ${c.deviceSpecificExpiry.month}/${c.deviceSpecificExpiry.year}`, c.paymentAccountReference && `PAR ${c.paymentAccountReference}`].filter(Boolean).join(' · '); }
    else if (sof.token) { v = 'MPGS gateway token, sent as the card'; tone = WARN; note = `Token ${sof.token} paid as ${sof.type}. No network token was used (not provisioned yet, or NT off for the repository).`; }
    out.push({ key: 'credential', label: 'Processed as', value: v, tone, note });
    if (c.number || c.brand) out.push({ key: 'card', label: 'Card', value: `${c.brand || ''} ${c.number || ''}`.trim(), tone: INFO, note: [c.fundingMethod, c.issuer, c.storedOnFile && `storedOnFile ${c.storedOnFile}`].filter(Boolean).join(' · ') || undefined });
  }
  const src = t.transaction?.source;
  if (src || t.agreement) out.push({ key: 'cof', label: 'Initiator / card on file', value: src === 'MERCHANT' ? 'Merchant-initiated (MIT)' : src === 'MOTO' ? 'MOTO' : src === 'INTERNET' ? 'Customer-initiated (CIT)' : src || '—', tone: INFO, note: t.agreement?.id ? `agreement ${t.agreement.id} (${t.agreement.type || 'type n/a'})` : undefined });

  const csc = t.response?.cardSecurityCode?.gatewayCode;
  if (csc && CSC_GW[csc]) out.push({ key: 'cvv', label: 'CVV check', value: CSC_GW[csc][0], tone: CSC_GW[csc][1] });

  const ar = t.authorizationResponse || {};
  if (t.transaction?.acquirer || ar.financialNetworkCode || t.transaction?.receipt) {
    out.push({ key: 'processor', label: 'Processor', value: 'MPGS (direct, not through PGW)', tone: INFO, note: [t.transaction?.acquirer?.id && `acquirer link ${t.transaction.acquirer.id}`, ar.financialNetworkCode && `network ${ar.financialNetworkCode}`, ar.transactionIdentifier && `scheme TID ${ar.transactionIdentifier}`, t.transaction?.receipt && `RRN ${t.transaction.receipt}`, t.transaction?.authorizationCode && `auth code ${t.transaction.authorizationCode}`, ar.posEntryMode && `POS entry ${ar.posEntryMode}`].filter(Boolean).join(' · ') });
  }
  if (ar.vpasResponse !== undefined && VPAS[String(ar.vpasResponse)]) out.push({ key: 'vpas', label: 'Visa CAVV check', value: VPAS[String(ar.vpasResponse)][0], tone: VPAS[String(ar.vpasResponse)][1] });
  if (ar.returnAci && ACI[ar.returnAci]) out.push({ key: 'aci', label: 'Visa category (ACI)', value: ACI[ar.returnAci][0], tone: ACI[ar.returnAci][1] });
  if (ar.merchantAdviceCode && ar.merchantAdviceCode !== '00') {
    const m = (MAC[brand] || {})[String(ar.merchantAdviceCode)] || MAC.mastercard[String(ar.merchantAdviceCode).padStart(2, '0')] || [`Code ${ar.merchantAdviceCode}`, WARN];
    out.push({ key: 'mac', label: 'Merchant advice (retry rule)', value: m[0], tone: m[1] });
  }
  if (isOrder || order.totalAuthorizedAmount !== undefined) out.push({ key: 'amounts', label: 'Amounts', value: `Authorized ${money(order.totalAuthorizedAmount, order.currency)}`, tone: INFO, note: `Captured ${money(order.totalCapturedAmount, order.currency)} · Refunded ${money(order.totalRefundedAmount, order.currency)}` });
  if (t.transaction?.type || isOrder) out.push({ key: 'pgw', label: 'PGW / APEX', value: 'Not in PGW', tone: WARN, note: 'Sent straight to MPGS: no PGW order, so PGW does not federate it to APEX. Settlement depends on the MPGS clearing file only.' });
  if (!out.length) out.push({ key: 'http', label: 'Result', value: b.result || 'OK', tone: b.result === 'SUCCESS' ? GOOD : INFO });
  return out;
}


// ----- direct CYBS responses (payments, captures, refunds, voids, payer auth, TMS, transaction search) -----
// Network-token reading from the 11-Nov CYBS POC: token BIN in paymentInformation.bin, tokenizedCard.requestorId
// (Geidea: Visa 40020570030, Mastercard 50146191319), paymentSolution 015 (Visa) / 014 (Mastercard).
const CY_STATUS = {
  AUTHORIZED: ['Authorized', GOOD], PARTIAL_AUTHORIZED: ['Partially authorized', WARN], AUTHORIZED_PENDING_REVIEW: ['Authorized, pending Decision Manager review', WARN],
  AUTHORIZED_RISK_DECLINED: ['Authorized by issuer but declined by Decision Manager', BAD], DECLINED: ['Declined', BAD], INVALID_REQUEST: ['Invalid request', BAD],
  PENDING_AUTHENTICATION: ['3DS challenge required', INFO], PENDING: ['Accepted, pending settlement', GOOD], TRANSMITTED: ['Sent to the processor', GOOD],
  VOIDED: ['Voided', INFO], REVERSED: ['Authorization reversed', INFO], COMPLETED: ['Completed', GOOD], AUTHENTICATION_SUCCESSFUL: ['Authenticated', GOOD],
  AUTHENTICATION_FAILED: ['Authentication failed', BAD], SERVER_ERROR: ['CYBS server error', WARN],
};
const CY_SOLUTION = { '015': 'Visa card-on-file network token', '014': 'Mastercard card-on-file network token', '001': 'Apple Pay', '012': 'Google Pay', '008': 'Samsung Pay', '027': 'Click to Pay' };
const CY_CARD = { '001': 'Visa', '002': 'Mastercard', '003': 'Amex' };
const CY_REQUESTOR = { '40020570030': 'Geidea Visa token requestor', '50146191319': 'Geidea Mastercard token requestor' };

export function isCybsBody(b) {
  if (!b || typeof b !== 'object') return false;
  return !!(b.submitTimeUtc || b.clientReferenceInformation || b.errorInformation || b.applicationInformation || b.tokenizedCard || b.jwt || (b._links && !b.responseCode));
}

export function cybsInsights(b) {
  if (!b) return [];
  const out = [];
  if (b.jwt) return [{ key: 'session', label: 'Microform', value: 'Capture context created', tone: GOOD, note: 'JWT the browser uses to load the CYBS-hosted card fields.' }];
  // TMS instrument identifier
  if (b.tokenizedCard || (b.id && b.object === 'instrumentIdentifier') || (b.card && b.state && b._links)) {
    out.push({ key: 'token', label: 'Instrument identifier', value: b.id || '—', tone: b.state === 'ACTIVE' ? GOOD : WARN, note: [b.state && `state ${b.state}`, b.card?.number && `card ${b.card.number}`].filter(Boolean).join(' · ') || undefined });
    const tc = b.tokenizedCard;
    out.push(tc?.state === 'ACTIVE'
      ? { key: 'credential', label: 'Network token', value: `Yes: ${String(tc.type || '').toLowerCase() === 'visa' ? 'Visa (VTS)' : String(tc.type || '').toLowerCase() === 'mastercard' ? 'Mastercard (MDES)' : tc.type}`, tone: GOOD, note: [tc.number && `token ${tc.number}`, tc.expirationMonth && `expiry ${tc.expirationMonth}/${tc.expirationYear}`, tc.source && `source ${tc.source}`].filter(Boolean).join(' · ') }
      : { key: 'credential', label: 'Network token', value: tc?.state ? `Not usable (${tc.state})` : 'None', tone: WARN, note: tc?.reason || 'No tokenizedCard on this instrument identifier.' });
    return out;
  }
  const err = b.errorInformation;
  const st = b.status || b.applicationInformation?.status;
  if (st) {
    const m = CY_STATUS[st] || [st, INFO];
    out.push({ key: 'outcome', label: 'Outcome', value: m[0], tone: m[1], note: [b.id && `CYBS id ${b.id}`, b.applicationInformation?.reasonCode && `reason ${b.applicationInformation.reasonCode}`].filter(Boolean).join(' · ') || undefined });
  }
  if (err?.reason || err?.message || b.message) out.push({ key: st ? 'decline' : 'code', label: st ? 'Reason' : 'Result', value: err?.message || b.message || err?.reason, tone: BAD, note: [err?.reason, ...(err?.details || b.details || []).map((d) => `${d.field}: ${d.reason}`)].filter(Boolean).join(' · ') || undefined });
  const p = b.processorInformation || {};
  if (p.responseCode && p.responseCode !== '00' && p.responseCode !== '0') {
    const de = explainDe39(p.responseCode);
    out.push({ key: 'acq', label: 'Processor code', value: de.meaning, tone: de.tone, note: `Code ${de.code}. ${de.advice}` });
  }
  if (b.riskInformation?.profile?.earlyDecision === 'REJECT' || err?.reason === 'DECISION_PROFILE_REJECT') out.push({ key: 'risk', label: 'Decision Manager', value: 'Rejected before authorization', tone: BAD, note: `Score ${b.riskInformation?.score?.result ?? '—'}. For MITs, DECISION_SKIP bypasses it (11-Nov POC).` });

  // 3DS
  const ca = b.consumerAuthenticationInformation || {};
  const pares = ca.paresStatus || ca.paresStatusReason;
  const eci = ca.eciRaw || ca.eci;
  const cardType = b.paymentInformation?.card?.type || b.paymentInformation?.tokenizedCard?.type || b.paymentAccountInformation?.card?.type;
  const brand = (CY_CARD[cardType] || '').toLowerCase();
  if (st === 'PENDING_AUTHENTICATION') out.push({ key: 'auth', label: '3DS authentication', value: 'Challenge required', tone: INFO, note: [ca.specificationVersion && `3DS ${ca.specificationVersion}`, ca.authenticationTransactionId && `auth txn ${ca.authenticationTransactionId}`].filter(Boolean).join(' · ') });
  else if (pares || eci || ca.veresEnrolled) {
    const t = TRANS_STATUS[ca.paresStatus] || [ca.veresEnrolled === 'Y' ? 'Enrolled' : `Status ${pares || 'n/a'}`, INFO];
    out.push({ key: 'auth', label: '3DS authentication', value: t[0], tone: t[1], note: [eci && `ECI ${eci}`, ca.specificationVersion && `3DS ${ca.specificationVersion}`, ca.veresEnrolled && `enrolled ${ca.veresEnrolled}`, ca.cavv && 'CAVV present', ca.ucafCollectionIndicator && `UCAF ${ca.ucafCollectionIndicator}`].filter(Boolean).join(' · ') });
    if (eci && st === 'AUTHORIZED') {
      const shift = (LIABILITY_ECI[brand] || ['01', '02', '05', '06']).includes(String(eci).padStart(2, '0'));
      out.push({ key: 'liability', label: 'Fraud liability', value: shift ? 'Shifted to issuer' : 'Stays with merchant / acquirer', tone: shift ? GOOD : WARN, note: `ECI ${eci}${brand ? ` on ${brand}` : ''}.` });
    }
  }

  // Credential: network token markers
  const pi = b.paymentInformation || {};
  const sol = b.processingInformation?.paymentSolution;
  const tcard = pi.tokenizedCard || {};
  const ii = b.tokenInformation?.instrumentIdentifier;
  if (st && st !== 'PENDING_AUTHENTICATION' && !['VOIDED', 'REVERSED', 'PENDING'].includes(st)) {
    const nt = ['014', '015'].includes(String(sol)) || tcard.requestorId;
    out.push(nt
      ? { key: 'credential', label: 'Processed as', value: 'Scheme (network) token', tone: GOOD, note: [CY_SOLUTION[sol] && `paymentSolution ${sol} (${CY_SOLUTION[sol]})`, pi.bin && `token BIN ${pi.bin}`, tcard.requestorId && `requestor ${tcard.requestorId}${CY_REQUESTOR[tcard.requestorId] ? ` (${CY_REQUESTOR[tcard.requestorId]})` : ''}`, p.paymentAccountReferenceNumber && `PAR ${p.paymentAccountReferenceNumber}`].filter(Boolean).join(' · ') }
      : { key: 'credential', label: 'Processed as', value: CY_SOLUTION[sol] || (ii?.id ? 'Card (instrument identifier, no network token used)' : 'Card number (PAN)'), tone: ii?.id && !CY_SOLUTION[sol] ? WARN : INFO, note: [pi.bin && `BIN ${pi.bin}`, ii?.id && `instrument identifier ${ii.id}${ii && b.tokenInformation?.instrumentIdentifierNewlyCreated !== undefined ? (b.tokenInformation.instrumentIdentifierNewlyCreated ? ' (new)' : ' (existing)') : ''}`].filter(Boolean).join(' · ') || undefined });
    if (cardType || pi.card?.suffix) out.push({ key: 'card', label: 'Card', value: `${CY_CARD[cardType] || cardType || ''} ${pi.card?.suffix ? `•••• ${pi.card.suffix}` : ''}`.trim(), tone: INFO });
  }
  const cvv = p.cardVerification?.resultCode;
  const CVV = { M: ['CVV matched', GOOD], N: ['CVV did not match', BAD], P: ['CVV not processed', WARN], S: ['CVV should be present but was not', WARN], U: ['Issuer not certified for CVV', WARN] };
  if (cvv && CVV[cvv]) out.push({ key: 'cvv', label: 'CVV check', value: CVV[cvv][0], tone: CVV[cvv][1] });
  if (p.approvalCode || p.networkTransactionId || p.transactionId) out.push({ key: 'processor', label: 'Processor', value: 'CYBS (direct, not through PGW)', tone: INFO, note: [p.approvalCode && `auth code ${p.approvalCode}`, p.networkTransactionId && `NTID ${p.networkTransactionId}`, p.retrievalReferenceNumber && `RRN ${p.retrievalReferenceNumber}`, p.merchantNumber && `MID ${p.merchantNumber}`].filter(Boolean).join(' · ') });
  const mac = p.merchantAdvice?.code;
  if (mac && mac !== '00') out.push({ key: 'mac', label: 'Merchant advice (retry rule)', value: (MAC[brand] || {})[mac]?.[0] || MAC.mastercard[String(mac).padStart(2, '0')]?.[0] || `Code ${mac}`, tone: WARN });
  const amt = b.orderInformation?.amountDetails;
  if (amt?.authorizedAmount || amt?.totalAmount) out.push({ key: 'amounts', label: 'Amounts', value: `${amt.currency || ''} ${amt.authorizedAmount || amt.totalAmount}`.trim(), tone: INFO });
  if (st && st !== 'PENDING_AUTHENTICATION') out.push({ key: 'pgw', label: 'PGW / APEX', value: 'Not in PGW', tone: WARN, note: 'Sent straight to CYBS: no PGW order, so PGW does not federate it to APEX.' });
  if (b.consumerAuthenticationInformation?.deviceDataCollectionUrl) out.push({ key: 'ddc', label: '3DS setup', value: 'Device data collection ready', tone: GOOD, note: `referenceId ${b.consumerAuthenticationInformation.referenceId}` });
  if (!out.length) out.push({ key: 'http', label: 'Result', value: st || 'OK', tone: INFO });
  return out;
}

// ----- any API response (session, capture, refund, errors) -----
export function responseInsights({ action, status, res_body: body, error }) {
  if (error) return [{ key: 'net', label: 'Network', value: error, tone: BAD, note: 'The call did not reach the gateway or timed out.' }];
  if (isCybsBody(body)) {
    const c = cybsInsights(body);
    if (status === 401) c.unshift({ key: 'http', label: 'Rejected', value: 'CYBS authentication failed', tone: BAD, note: 'Check the CYBS merchant ID, REST key ID and shared secret for this environment.' });
    return c;
  }
  if (isMpgsBody(body)) {
    const m = mpgsInsights(body);
    if (status === 401) m.unshift({ key: 'http', label: 'Rejected', value: 'MPGS authentication failed', tone: BAD, note: 'Check the MPGS merchant ID and API password for this environment.' });
    return m;
  }
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
