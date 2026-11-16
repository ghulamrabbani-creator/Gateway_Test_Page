'use client';
// R21: read-only live log for pages a flow lands on (Geidea return page): every call for the order, oldest first.
import { useEffect } from 'react';
import { useSettings } from '@/lib/clientState';
import { useLiveLog } from '@/lib/liveLog';
import LiveLog from './LiveLog';

export default function OrderLog({ refId }) {
  const [s] = useSettings();
  const live = useLiveLog(false);
  useEffect(() => { live.track(refId); }, [refId]); // eslint-disable-line react-hooks/exhaustive-deps
  return <LiveLog live={live} stepMode={!!s.stepMode} />;
}
