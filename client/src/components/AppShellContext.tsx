/**
 * Tells a screen whether it is being shown inside the signed-in sidebar
 * layout (AppLayout). Inside the layout the sidebar already provides the
 * logo, navigation and Sign out, so each screen's own top bar and footer are
 * hidden with <HideInAppShell>. Outside the layout (or if a screen is ever
 * rendered on its own) they show exactly as before.
 */
import { createContext, useContext, type ReactNode } from 'react';

export const AppShellContext = createContext(false);

export function useInAppShell(): boolean {
  return useContext(AppShellContext);
}

/** Renders its children only when NOT inside the sidebar layout. */
export function HideInAppShell({ children }: { children: ReactNode }) {
  return useInAppShell() ? null : <>{children}</>;
}
