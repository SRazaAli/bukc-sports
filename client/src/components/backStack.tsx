/**
 * In-page "Go back" steps.
 *
 * A page that opens another view from one of its own buttons (Add Venue form,
 * a request's review panel, step 2 of a wizard…) registers a "back step"
 * while that view is open:
 *
 *   useBackStep(showForm, () => setShowForm(false));
 *
 * The Go back button in AppLayout is enabled only while at least one step is
 * open, and clicking it runs the most recent / deepest step's close action —
 * exactly what the page's own Cancel / Back button already does. On the first
 * view of every sidebar page nothing is registered, so Go back is disabled.
 *
 * `depth` orders nested views: a step inside a panel (e.g. the reject form
 * inside the review panel) uses a higher depth so it closes first.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';

type Step = { id: number; depth: number; run: MutableRefObject<() => void> };
type Registry = { register: (depth: number, run: MutableRefObject<() => void>) => () => void };

const BackStackContext = createContext<Registry | null>(null);
export const BackStackProvider = BackStackContext.Provider;

export function useBackStep(active: boolean, onBack: () => void, depth = 0) {
  const registry = useContext(BackStackContext);
  const run = useRef(onBack);
  run.current = onBack;
  useEffect(() => {
    if (!active || !registry) return;
    return registry.register(depth, run);
  }, [active, registry, depth]);
}

/** Used once, by AppLayout. */
export function useBackStackRegistry() {
  const [steps, setSteps] = useState<Step[]>([]);
  const nextId = useRef(0);
  const register = useCallback<Registry['register']>((depth, run) => {
    const id = ++nextId.current;
    setSteps((s) => [...s, { id, depth, run }]);
    return () => setSteps((s) => s.filter((x) => x.id !== id));
  }, []);
  const registry = useMemo<Registry>(() => ({ register }), [register]);
  const top = steps.reduce<Step | null>(
    (best, s) => (!best || s.depth > best.depth || (s.depth === best.depth && s.id > best.id) ? s : best),
    null,
  );
  const stepBack = useCallback(() => { top?.run.current(); }, [top]);
  return { registry, hasStep: top !== null, stepBack };
}
