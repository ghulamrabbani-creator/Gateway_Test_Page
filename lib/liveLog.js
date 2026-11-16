'use client';
// R21: live log + step-by-step mode for the multi-step card flows.
// track(ref) shows every API call for that order. during(label, fn) runs one step: it shows "Sending <label>…",
// polls the order's api_logs while the step runs (a request appears as soon as the server sends it, the response
// when it comes back), then refreshes once more. gate(next) pauses the flow in step mode until Continue is pressed.
import { useEffect, useRef, useState } from 'react';

export function useLiveLog(stepMode) {
  const [refId, setRefId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [pending, setPending] = useState('');
  const [pause, setPause] = useState(null);
  const refRef = useRef(null);
  const modeRef = useRef(!!stepMode);
  const skipRef = useRef(false);
  useEffect(() => { modeRef.current = !!stepMode; }, [stepMode]);

  async function pull(ref = refRef.current) {
    if (!ref) return [];
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(ref)}/logs`, { cache: 'no-store' });
      const j = await r.json();
      if (r.ok && ref === refRef.current) setLogs(j.logs || []);
      return j.logs || [];
    } catch { return []; }
  }

  function track(ref) {
    if (!ref) return;
    if (refRef.current !== ref) { refRef.current = ref; setRefId(ref); setLogs([]); }
    return pull(ref);
  }

  async function during(label, fn) {
    setPending(label);
    let alive = true;
    const loop = (async () => { while (alive) { await new Promise((r) => setTimeout(r, 700)); if (alive) await pull(); } })();
    try { return await fn(); }
    finally { alive = false; await loop.catch(() => {}); await pull(); setPending(''); }
  }

  function gate(next) {
    if (!modeRef.current || skipRef.current) return Promise.resolve();
    return new Promise((resolve) => setPause({ next, resolve }));
  }
  function cont() { const p = pause; setPause(null); p?.resolve(); }
  function runAll() { skipRef.current = true; cont(); }
  // Start over: a paused flow is abandoned (its promise never resolves), not continued.
  function reset() { refRef.current = null; skipRef.current = false; setRefId(null); setLogs([]); setPending(''); setPause(null); }

  return { refId, logs, pending, pause, track, pull, during, gate, cont, runAll, reset };
}
