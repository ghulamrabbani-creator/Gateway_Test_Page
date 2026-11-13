'use client';
import { useState } from 'react';

// Copies `text` to the clipboard. Falls back to a hidden textarea where the Clipboard API is blocked.
export default function CopyButton({ text, label = 'Copy' }) {
  const [state, setState] = useState('');
  async function copy(e) {
    e.preventDefault();
    e.stopPropagation(); // don't toggle the surrounding <details>
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setState('Copied');
    } catch {
      setState('Copy failed');
    }
    setTimeout(() => setState(''), 1500);
  }
  return (
    <button type="button" className="ghost copy" onClick={copy} title="Copy to clipboard">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      {state || label}
    </button>
  );
}
