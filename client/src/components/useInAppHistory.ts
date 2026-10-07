/**
 * Remembers the pages visited inside the signed-in app (in this browser tab)
 * so the "Go back" button returns to the page before the current one — and
 * never back out to the login screen.
 *
 * The list mirrors the browser's own history for in-app pages:
 *  - normal navigation (sidebar link, button inside a page) → adds the page
 *  - redirects (replace) → swap the current entry
 *  - browser back/forward → steps back if it's the previous page, else adds
 * It's kept in sessionStorage so a page refresh doesn't lose it, and it's
 * cleared on sign out.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

const KEY = 'bukc:navStack';
const MAX = 50;

function load(): string[] {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function save(stack: string[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX))); } catch { /* storage unavailable — fine */ }
}
export function clearInAppHistory() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function useInAppHistory() {
  const location = useLocation();
  const navType = useNavigationType();
  const navigate = useNavigate();
  const here = location.pathname + location.search;
  const firstRun = useRef(true);
  const [stack, setStack] = useState<string[]>(() => load());

  useEffect(() => {
    setStack((prev) => {
      let next: string[];
      if (firstRun.current) {
        firstRun.current = false;
        // Arriving from outside the app (e.g. just logged in) starts a fresh list.
        // A refresh / browser back into the app keeps the saved list if it matches.
        next = navType === 'POP' && prev[prev.length - 1] === here ? prev : [here];
      } else if (prev[prev.length - 1] === here) {
        next = prev; // same page (e.g. clicking the current sidebar link)
      } else if (navType === 'REPLACE') {
        next = [...prev.slice(0, -1), here];
      } else if (navType === 'POP') {
        next = prev[prev.length - 2] === here ? prev.slice(0, -1) : [...prev, here];
      } else {
        next = [...prev, here];
      }
      save(next);
      return next;
    });
  }, [here, navType]);

  const canGoBack = stack.length >= 2;
  const previous = canGoBack ? stack[stack.length - 2]! : null;
  // The saved list mirrors browser history, so one step back is the previous in-app page.
  const goBack = useCallback(() => { if (canGoBack) navigate(-1); }, [canGoBack, navigate]);

  return { canGoBack, previous, goBack };
}
