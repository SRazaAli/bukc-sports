/**
 * Live sidebar number for the role's venue link (same polling pattern as
 * useUnreadMessages):
 *   External    → "Book a Venue": a request was approved / rejected
 *   Coordinator → "Venue Queue": a new request, or a Super Admin decision
 *   Super Admin → "Venue Approvals": a request forwarded for a decision
 * Opening that page marks them seen, so the number clears.
 */
import { useCallback, useEffect, useState } from 'react';
import { getVenueBadge, markVenueBadgeSeen } from '../features/venue/api.js';

const POLL_MS = 15_000;

export function useVenueBadge(enabled: boolean, pathname: string, pagePath: string | null) {
  const [count, setCount] = useState(0);
  const onPage = !!pagePath && (pathname === pagePath || pathname.startsWith(pagePath + '/'));

  const refresh = useCallback(() => {
    if (!enabled) return;
    if (onPage) {
      // Looking at the page = seen. Anything new that arrives while it's open is cleared too.
      setCount(0);
      markVenueBadgeSeen().catch(() => { /* retry on next poll */ });
      return;
    }
    getVenueBadge().then((r) => setCount(r.count)).catch(() => { /* keep last value */ });
  }, [enabled, onPage]);

  useEffect(() => { refresh(); }, [refresh, pathname]);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, refresh]);
  return count;
}
