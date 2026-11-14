/**
 * Live sidebar counts for the borrow feature (same polling pattern as
 * useUnreadMessages): Coordinator → pending Borrow Queue requests and
 * Equipment Alerts needing attention;
 * Student → newly approved borrow requests not yet seen.
 */
import { useCallback, useEffect, useState } from 'react';
import { BORROW_BADGES_CHANGED, getBadges } from '../features/borrow/deskApi.js';

const POLL_MS = 20_000;

export function useBorrowBadges(enabled: boolean, pathname: string) {
  const [counts, setCounts] = useState<{ borrowQueue: number; myBorrowRequests: number; equipmentAlerts: number }>({ borrowQueue: 0, myBorrowRequests: 0, equipmentAlerts: 0 });
  const refresh = useCallback(() => {
    if (!enabled) return;
    getBadges()
      .then((r) => setCounts({ borrowQueue: r.borrowQueue ?? 0, myBorrowRequests: r.myBorrowRequests ?? 0, equipmentAlerts: r.equipmentAlerts ?? 0 }))
      .catch(() => { /* keep last value */ });
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh, pathname]);
  useEffect(() => {
    if (!enabled) { setCounts({ borrowQueue: 0, myBorrowRequests: 0, equipmentAlerts: 0 }); return; }
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(BORROW_BADGES_CHANGED, refresh);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); window.removeEventListener(BORROW_BADGES_CHANGED, refresh); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, refresh]);
  return counts;
}
