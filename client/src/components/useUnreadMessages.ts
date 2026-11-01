/**
 * Live unread number for the sidebar's "Messages" link.
 *   Coordinator → how many chats have unread messages.
 *   Everyone else → how many messages from the Coordinators are unread.
 * Refreshes every 15 s, when the page changes, when the tab becomes visible
 * again, and immediately when the Messages page reads or sends something.
 */
import { useCallback, useEffect, useState } from 'react';
import { getUnreadCount, MESSAGES_CHANGED } from '../features/messages/api.js';

const POLL_MS = 15_000;

export function useUnreadMessages(enabled: boolean, pathname: string) {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    if (!enabled) return;
    getUnreadCount().then((r) => setCount(r.count)).catch(() => { /* keep last value */ });
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh, pathname]);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener(MESSAGES_CHANGED, refresh);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); window.removeEventListener(MESSAGES_CHANGED, refresh); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, refresh]);
  return count;
}
