'use client';
// Shop settings and cart are kept per browser (localStorage), like a real shopper's session.
import { useEffect, useState } from 'react';

export const DEFAULT_SETTINGS = {
  env: 'test', route: 'geidea', txType: 'sale', amount: '1.00', citId: null, mitId: null, manualToken: '', manualAgreementId: '', manualAgreementType: 'Unscheduled', mode: 'modal', hppProfile: 'simple', language: 'en', hideWallets: false,
  operation: 'Pay', auth: '3ds', saveCard: 'none', agreementType: 'Unscheduled', currency: 'AED', tokenId: '', mpgsToken: '', mpgsCard: '', mpgsAgreementId: '', mpgsTokenValue: 'geidea', cybsIi: '', cybsExpiry: null, cybsSkipDm: false,
  showEmail: false, showPhone: false, showAddress: false, receiptPage: false, showMerchantName: true, hideGeideaLogo: false, headerColor: '',
};

function useStored(key, initial) {
  const [v, setV] = useState(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { const s = localStorage.getItem(key); if (s) setV({ ...initial, ...JSON.parse(s) }); } catch {}
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next) => {
    setV((prev) => {
      const val = typeof next === 'function' ? next(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
      return val;
    });
  };
  return [v, save, ready];
}

export const useSettings = () => useStored('ts_settings', DEFAULT_SETTINGS);
