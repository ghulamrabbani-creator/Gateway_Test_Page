// Run: npm run test:insights  — checks the insights rules and signature helpers on sample payloads.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { orderInsights, responseInsights, explainDe39 } from '../lib/insights.js';

const pick = (list, key) => list.find((i) => i.key === key);

// 1. Success, 3DS Y / ECI 02 on Mastercard, CyberSource pay leg (shape from pgw-order-model-reference.md)
const ok = {
  orderId: 'ca7e', merchantReferenceId: 'CIT-1', status: 'Success', detailedStatus: 'Paid', gatewayDecision: 'Reject', isTest: false,
  currency: 'AED', amount: 1, totalAuthorizedAmount: 1, totalCapturedAmount: 1, totalRefundedAmount: 0, initiatedBy: 'Internet',
  isPayWithToken: true, isTokenPayment: true, tokenId: '40e6',
  paymentMethod: { type: 'Card', brand: 'mastercard', maskedCardNumber: '557652******2860', fundingType: 'DEBIT', issuingBank: 'ABU DHABI COMMERCIAL BANK', issuingCountry: 'ARE' },
  transactions: [
    { type: 'Authentication', status: 'Success', codes: { responseCode: '000', detailedResponseCode: '000' }, authenticationDetails: { acsEci: '02', transactionStatus: 'Y', protocolVersion: '2.2.0' } },
    { type: 'Pay', status: 'Success', rrn: '621017060458', authorizationCode: '083190', codes: { responseCode: '000', detailedResponseCode: '000' }, cybersourceDetails: { networkTransactionId: '0729WDRT6N5WS', processorInfoResponseCode: '00' } },
  ],
};
let ins = orderInsights(ok);
assert.equal(pick(ins, 'outcome').tone, 'good');
assert.match(pick(ins, 'outcome').value, /Paid/);
assert.equal(pick(ins, 'auth').value, 'Fully authenticated');
assert.equal(pick(ins, 'liability').value, 'Shifted to issuer');
assert.equal(pick(ins, 'processor').value, 'CyberSource');
assert.equal(pick(ins, 'credential').value, 'Geidea token (card on file)');
assert.ok(pick(ins, 'gd'), 'flags gatewayDecision Reject on success');
assert.ok(!pick(ins, 'decline'));

// 2. Visa attempt ECI 06 → liability shift; Visa ECI 07 → no shift
const visa = (eci, ts) => ({ ...ok, paymentMethod: { ...ok.paymentMethod, brand: 'visa' }, transactions: [{ ...ok.transactions[0], authenticationDetails: { acsEci: eci, transactionStatus: ts } }, ok.transactions[1]] });
assert.equal(pick(orderInsights(visa('06', 'A')), 'liability').value, 'Shifted to issuer');
assert.equal(pick(orderInsights(visa('07', 'U')), 'liability').value, 'Stays with merchant / acquirer');
// Mastercard with Visa-style ECI 05 must NOT shift
assert.equal(pick(orderInsights({ ...ok, transactions: [{ ...ok.transactions[0], authenticationDetails: { acsEci: '05', transactionStatus: 'Y' } }, ok.transactions[1]] }), 'liability').value, 'Stays with merchant / acquirer');

// 3. Decline with acquirer code 51 + 3DS fail code
const declined = { ...ok, status: 'Failed', detailedStatus: 'Failed', transactions: [ok.transactions[0], { type: 'Pay', status: 'Failed', codes: { responseCode: '999', detailedResponseCode: '999', acquirerCode: '51', acquirerMessage: 'Insufficient funds' } }] };
ins = orderInsights(declined);
assert.equal(pick(ins, 'decline').value, 'Insufficient funds / over limit');
assert.match(pick(ins, 'decline').note, /different amount or card/);
const failed3ds = { ...ok, status: 'Failed', detailedStatus: 'AuthenticationFailed', transactions: [{ type: 'Authentication', status: 'Failed', codes: { responseCode: '300', detailedResponseCode: '004' }, authenticationDetails: { acsEci: '00', transactionStatus: 'N' } }] };
ins = orderInsights(failed3ds);
assert.match(pick(ins, 'decline').value, /3DS failed/);
assert.equal(pick(ins, 'auth').value, 'Failed');

// 4. MIT: no auth expected, network token marker, MAC 03
const mit = { ...ok, initiatedBy: 'Merchant', agreementId: 'agg-1', agreementType: 'Unscheduled', transactions: [{ type: 'Pay', status: 'Success', codes: { responseCode: '000' }, cybersourceDetails: { paymentSolution: '014', merchantAdviceCode: '03' } }] };
ins = orderInsights(mit);
assert.equal(pick(ins, 'auth').tone, 'info');
assert.match(pick(ins, 'auth').note, /MIT/);
assert.equal(pick(ins, 'credential').value, 'Scheme (network) token');
assert.equal(pick(ins, 'mac').value, 'Do not try again');
assert.match(pick(ins, 'cof').value, /Merchant-initiated/);

// 5. Response-level: MOTO not enabled, 401, validation errors, session created
assert.match(pick(responseInsights({ status: 200, res_body: { responseCode: '110', detailedResponseCode: '019', responseMessage: 'x' } }), 'code').value, /MOTO/);
assert.equal(pick(responseInsights({ status: 401, res_body: null }), 'http').value, 'Authentication to Geidea failed');
assert.match(pick(responseInsights({ status: 400, res_body: { errors: { Signature: ['invalid'] } } }), 'validation').value, /Signature/);
assert.ok(pick(responseInsights({ status: 200, res_body: { responseCode: '000', detailedResponseCode: '000', session: { id: 's1' } } }), 'session'));
assert.equal(responseInsights({ error: 'Timed out after 30 s' })[0].key, 'net');
assert.equal(explainDe39('5').code, '05');

// 6. Signature recipe = reference §2 (HMAC-SHA256, key apiPassword, Base64; amount 2 dp)
const hm = (d, k) => crypto.createHmac('sha256', k).update(d).digest('base64');
const { sessionSignature, refundSignature, tokenPaySignature, geideaTimestamp } = await import('./sig-shim.mjs');
assert.equal(sessionSignature('PK', 1, 'AED', 'REF', 'TS', 'PWD'), hm('PK1.00AEDREFTS', 'PWD'));
assert.equal(refundSignature('TS', 'PK', 2.5, 'OID', 'PWD'), hm('TSPK2.50OID', 'PWD'));
assert.equal(tokenPaySignature('PK', 'SID', 'PWD'), hm('PKSID', 'PWD'));
assert.equal(geideaTimestamp(new Date(Date.UTC(2026, 10, 10, 14, 59, 0))), '11/10/2026 02:59:00 PM');
assert.equal(geideaTimestamp(new Date(Date.UTC(2026, 0, 2, 0, 5, 9))), '01/02/2026 12:05:09 AM');

// 7. Summary record from fetch-by-reference (real response 13-Nov-2026): no false "no 3DS / merchant liable"; USD settlement flagged
const summary = { status: 'Success', detailedStatus: 'Paid', currency: 'AED', amount: 1, transactions: [], paymentMethod: null, threeDSecureId: '4b3a', initiatedBy: 'Internet', totalAuthorizedAmount: 0,
  multiCurrency: { authAmount: 1, authCurrency: 'AED', exchangeRate: 0.272294, settleAmount: 0.27, settleCurrency: 'USD', exchangeFeeAmount: 0 } };
ins = orderInsights(summary);
assert.equal(pick(ins, 'auth').value, 'Not in this response');
assert.ok(!pick(ins, 'liability'));
assert.equal(pick(ins, 'summary').value, 'Summary record only');
assert.match(pick(ins, 'settle').value, /USD/);
assert.equal(pick(ins, 'credential').value, 'Not in this response');
assert.match(pick(responseInsights({ status: 200, res_body: { responseCode: '110', detailedResponseCode: '013' } }), 'code').value, /billing address/);

console.log('All insights and signature checks passed');
