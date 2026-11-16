'use client';
// R23: on a Geidea (PGW) order, look the same order up on MPGS. PGW creates the MPGS order with ID = Geidea orderId,
// so this shows what PGW actually sent to MPGS: PAY vs AUTHORIZATION + CAPTURE, source, stored-on-file, agreement,
// card vs scheme token. View only. If MPGS has no such order, PGW routed the payment elsewhere (e.g. CYBS).
import { useState } from 'react';
import Insights from './Insights';
import CopyButton from './CopyButton';
import { fmtDT } from '@/lib/time';

const TXN = { PAYMENT: 'Pay (auth + capture in one)', AUTHORIZATION: 'Authorization', CAPTURE: 'Capture', REFUND: 'Refund', VOID_PAYMENT: 'Void of payment', VOID_AUTHORIZATION: 'Void of authorization', VOID_CAPTURE: 'Void of capture', AUTHENTICATION: '3DS authentication', VERIFICATION: 'Verification' };

export default function MpgsCheck({ refId, geideaOrderId }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  async function look() {
    setBusy(true);
    const r = await fetch('/api/lookup/gateway', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gateway: 'mpgs', orderRef: refId, id: geideaOrderId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setRes(r.ok ? j : { error: j.error });
  }
  const mo = res?.body;
  const found = res?.ok && mo?.id;
  const txns = found ? (Array.isArray(mo.transaction) ? mo.transaction : []) : [];
  // R24: did a payment ever reach MPGS, and did MPGS's own risk screening say no?
  const paid = txns.some((t) => ['PAYMENT', 'AUTHORIZATION', 'CAPTURE'].includes(t.transaction?.type));
  const riskNo = txns.map((t) => t.risk || mo.risk).find((r) => r?.response?.gatewayCode && r.response.gatewayCode !== 'ACCEPTED');
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>On MPGS</h2>
        <button className="ghost" disabled={busy || !geideaOrderId} onClick={look}>{busy ? 'Asking MPGS…' : res ? 'Look up again' : 'Look up this order in MPGS'}</button>
      </div>
      <p className="sub" style={{ margin: '6px 0 0' }}>MPGS order ID <span className="mono">{geideaOrderId || '—'}</span> (PGW uses the Geidea orderId). View only; the call is added to the request inspector below.</p>
      {res?.error && <div className="msg bad">{res.error}</div>}
      {res && !res.error && !found && <div className="msg warn">MPGS has no order with this ID (HTTP {res.status}). PGW probably sent this payment to another gateway (CyberSource), or under a different MPGS merchant ID than the one set in Admin.</div>}
      {found && !paid && <div className="msg warn">MPGS holds only {txns.length ? txns.map((t) => t.transaction?.type).join(', ') : 'the order'} for this order: <b>no payment reached MPGS</b>. If PGW shows the payment failed, PGW stopped it itself before sending it on (not MPGS, not the issuer, and not Decision Manager, which runs only on CyberSource).</div>}
      {found && riskNo && <div className="msg bad">MPGS risk assessment: <b>{riskNo.response.gatewayCode}</b>{riskNo.response.review?.decision ? ` · review ${riskNo.response.review.decision}` : ''}{Array.isArray(riskNo.response.rule) ? ` · rules ${riskNo.response.rule.map((r) => `${r.name || r.id}: ${r.recommendation || r.result || ''}`).join(', ')}` : ''}</div>}
      {found && (<>
        <div className="kv" style={{ marginTop: 12 }}>
          <div>MPGS status</div><div className="mono">{mo.status}{mo.authenticationStatus ? ` · ${mo.authenticationStatus}` : ''}</div>
          <div>Authorized / captured / refunded</div><div>{mo.currency} {Number(mo.totalAuthorizedAmount || 0).toFixed(2)} / {Number(mo.totalCapturedAmount || 0).toFixed(2)} / {Number(mo.totalRefundedAmount || 0).toFixed(2)}</div>
          <div>Merchant</div><div className="mono">{mo.merchant}</div>
          {mo.agreement?.id && (<><div>Agreement on the order</div><div className="mono">{mo.agreement.id} ({mo.agreement.type || '—'})</div></>)}
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>MPGS transaction</th><th>Type</th><th>Source</th><th>Funds</th><th>Stored on file</th><th>Agreement</th><th>Result</th><th>Time (UAE)</th></tr></thead>
          <tbody>
            {txns.map((t, i) => {
              const tx = t.transaction || {};
              const sof = t.sourceOfFunds || {};
              const card = sof.provided?.card || {};
              return (
                <tr key={i}>
                  <td className="mono">{tx.id}</td>
                  <td>{TXN[tx.type] || tx.type}</td>
                  <td className="mono">{tx.source || '—'}</td>
                  <td className="mono">{sof.type || '—'}{card.number ? ` ${card.number}` : ''}{card.deviceSpecificNumber ? ` (token ${card.deviceSpecificNumber})` : ''}</td>
                  <td className="mono">{card.storedOnFile || '—'}</td>
                  <td className="mono">{t.agreement?.id ? `${t.agreement.id} (${t.agreement.type || '—'})` : '—'}</td>
                  <td className="mono">{t.response?.gatewayCode || t.result}{t.response?.acquirerCode ? ` · ${t.response.acquirerCode}` : ''}</td>
                  <td className="muted">{fmtDT(t.timeOfRecord)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>)}
      {res?.insights && <div style={{ marginTop: 12 }}><Insights items={res.insights} /></div>}
      {mo && <details style={{ marginTop: 10 }}><summary>Raw MPGS order</summary><div className="row" style={{ justifyContent: 'flex-end' }}><CopyButton text={JSON.stringify(mo, null, 2)} /></div><pre className="json">{JSON.stringify(mo, null, 2)}</pre></details>}
    </div>
  );
}
