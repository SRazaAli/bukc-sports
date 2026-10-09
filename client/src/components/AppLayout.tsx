/**
 * AppLayout — the signed-in layout: a collapsible, role-aware sidebar on the
 * left and the current page on the right.
 *
 *  - Top of the sidebar: university logo + "Bahria University / Sports
 *    Management Portal" (what each page's own header used to show), then the
 *    signed-in user's name and role.
 *  - Middle: the pages this role can open (see navigation.tsx), grouped into
 *    sections. The current page is highlighted.
 *  - Bottom: Sign out (same logout() + redirect to "/" as before).
 *  - Top right of every page: "Go back" — works inside the page. It is
 *    disabled on the first view of every sidebar link; once a button in the
 *    page opens another view (Add Venue form, a review panel, a wizard step,
 *    or a sub-page such as Availability → Borrow), it returns to the view
 *    that button was on (see backStack.tsx). Sidebar links are unchanged.
 *  - Collapse: desktop collapses to an icon-only rail (choice remembered in
 *    this browser); on small screens the sidebar becomes a slide-in drawer
 *    opened with the menu button.
 *
 * Every page keeps its own logic and state; inside this layout their old top
 * bar and footer are hidden via AppShellContext / <HideInAppShell>.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { AppShellContext } from './AppShellContext.js';
import { getNavItems, groupNavItems, isItemActive, ROLE_LABEL } from './navigation.js';
import { useInAppHistory, clearInAppHistory } from './useInAppHistory.js';
import { BackStackProvider, useBackStackRegistry } from './backStack.js';

const COLLAPSE_KEY = 'bukc:sidebarCollapsed';
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
function saveCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* storage unavailable — fine */ }
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

export default function AppLayout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { previous, goBack: historyBack } = useInAppHistory();
  const { registry, hasStep, stepBack } = useBackStackRegistry();

  // Close the mobile drawer whenever the page changes.
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  if (loading) {
    return (
      <div className="bukc-app" style={{ minHeight: '100vh', background: '#0F172B', display: 'grid', placeItems: 'center', color: '#90A1B9', fontFamily: 'Inter, system-ui, sans-serif' }}>
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;

  const navItems = getNavItems(user.role);
  const groups = groupNavItems(navItems);
  // A sub-page of the current sidebar item (e.g. /borrow/3 opened from
  // Equipment Availability) goes back to the page whose button opened it.
  const currentItem = navItems.find((i) => isItemActive(i, pathname));
  const onSubPage = !!currentItem && pathname !== currentItem.to && !!previous
    && previous.split('?')[0] !== pathname && isItemActive(currentItem, previous.split('?')[0]!);
  const canGoBack = hasStep || onSubPage;
  const goBack = () => { if (hasStep) stepBack(); else if (onSubPage) historyBack(); };
  const backTitle = canGoBack ? 'Go back to the previous view' : 'Nothing to go back to on this page';
  const toggleCollapsed = () => setCollapsed((c) => { saveCollapsed(!c); return !c; });

  async function onSignOut() {
    setSigningOut(true);
    clearInAppHistory();
    try { await logout(); } finally { navigate('/'); }
  }

  return (
    <div className={`bukc-app${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}>
      <ShellStyles />

      {/* Small-screen menu button (the sidebar is a drawer there) */}
      <button type="button" className="sb-mobile-toggle" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-expanded={mobileOpen} aria-controls="app-sidebar">
        <MenuIcon />
      </button>
      <div className="sb-backdrop" onClick={() => setMobileOpen(false)} aria-hidden />

      <aside id="app-sidebar" className="sb" aria-label="Main navigation">
        {/* Brand */}
        <div className="sb-brand">
          <Link to="/profile" className="sb-brand-link" title="Bahria University — Sports Management Portal">
            <img src="/landing/bu_logo.png" alt="Bahria University" className="sb-logo" />
            <span className="sb-brand-text">
              <span className="sb-wordmark">Bahria University</span>
              <span className="sb-wordmark-sub">Sports Management Portal</span>
            </span>
          </Link>
          <button type="button" className="sb-collapse" onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <CollapseIcon />
          </button>
          <button type="button" className="sb-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><CloseIcon /></button>
        </div>

        {/* Signed-in user */}
        <div className="sb-user" title={`${user.fullName} · ${ROLE_LABEL[user.role]}`}>
          <span className="sb-avatar" aria-hidden>{initials(user.fullName)}</span>
          <span className="sb-user-text">
            <span className="sb-user-name">{user.fullName}</span>
            <span className="sb-user-role">{ROLE_LABEL[user.role]}</span>
          </span>
        </div>

        {/* Role-based links */}
        <nav className="sb-nav">
          {groups.map((g) => (
            <div key={g.section} className="sb-group">
              <div className="sb-section">{g.section}</div>
              <ul>
                {g.items.map((item) => {
                  const active = isItemActive(item, pathname);
                  return (
                    <li key={item.key}>
                      <Link to={item.to} className={`sb-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}
                        data-tip={item.label}>
                        <span className="sb-icon">{item.icon}</span>
                        <span className="sb-label">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div className="sb-footer">
          <button type="button" className="sb-link sb-signout" onClick={onSignOut} disabled={signingOut} data-tip="Sign out">
            <span className="sb-icon"><SignOutIcon /></span>
            <span className="sb-label">{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </aside>

      <AppShellContext.Provider value={true}>
       <BackStackProvider value={registry}>
        <main className="app-main">
          {/* Go back — top right of every page */}
          <div className="app-topline">
            <button type="button" className="app-back" onClick={goBack} disabled={!canGoBack}
              title={backTitle} aria-label={backTitle}>
              <BackIcon /> Go back
            </button>
          </div>
          <Outlet />
        </main>
       </BackStackProvider>
      </AppShellContext.Provider>
    </div>
  );
}

/* ---------- styles ---------- */
const C = {
  navy900: '#0F172B',
  sbBg: '#0A1229',
  sbBg2: '#0D1838',
  line: 'rgba(255,255,255,0.08)',
  text: '#CAD5E2',
  muted: '#90A1B9',
  dim: '#62748E',
  accent: '#1C398E',
  accentLight: '#9DBBFF',
};

function ShellStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .bukc-app {
        --sb-w: 284px;
        display: flex; min-height: 100vh; background: ${C.navy900};
        font-family: 'Inter', system-ui, sans-serif;
      }
      .bukc-app.is-collapsed { --sb-w: 80px; }

      /* ── sidebar ── */
      .sb {
        position: sticky; top: 0; height: 100vh; flex: 0 0 var(--sb-w); width: var(--sb-w);
        display: flex; flex-direction: column; z-index: 50;
        background: linear-gradient(180deg, ${C.sbBg2} 0%, ${C.sbBg} 55%, #081022 100%);
        border-right: 1px solid ${C.line};
        box-shadow: 8px 0 30px -18px rgba(0,0,0,0.6);
        transition: width .22s ease, flex-basis .22s ease;
        overflow: hidden;
      }
      .sb-brand { display: flex; align-items: center; gap: 10px; padding: 18px 14px 14px 16px; min-height: 76px; }
      .sb-brand-link { display: flex; align-items: center; gap: 11px; min-width: 0; flex: 1; text-decoration: none; overflow: hidden; }
      .sb-logo { width: 42px; height: 42px; flex: 0 0 42px; border-radius: 11px; object-fit: contain; background: #F8FAFC; padding: 4px; border: 1px solid #CAD5E2; }
      .sb-brand-text { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
      .sb-wordmark { font-size: 15px; font-weight: 700; color: #fff; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sb-wordmark-sub { font-size: 11.5px; color: ${C.muted}; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sb-collapse, .sb-close {
        flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
        border-radius: 9px; border: 1px solid ${C.line}; background: rgba(255,255,255,0.04); color: ${C.muted}; cursor: pointer;
        transition: background-color .15s ease, color .15s ease, transform .22s ease;
      }
      .sb-collapse:hover, .sb-close:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .sb-close { display: none; }

      .sb-user { display: flex; align-items: center; gap: 11px; margin: 2px 14px 10px; padding: 11px 12px; border-radius: 13px;
        background: rgba(255,255,255,0.04); border: 1px solid ${C.line}; min-width: 0; }
      .sb-avatar { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
        font: 700 12.5px Inter, sans-serif; color: #fff; background: linear-gradient(135deg, #3B63D8, ${C.accent}); border: 1px solid rgba(157,187,255,0.35); }
      .sb-user-text { display: flex; flex-direction: column; min-width: 0; }
      .sb-user-name { font-size: 13.5px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sb-user-role { font-size: 11.5px; color: ${C.accentLight}; font-weight: 600; margin-top: 1px; white-space: nowrap; }

      .sb-nav { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 4px 12px 12px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }
      .sb-group + .sb-group { margin-top: 10px; }
      .sb-section { font: 700 10.5px Inter, sans-serif; letter-spacing: .09em; text-transform: uppercase; color: ${C.dim}; padding: 10px 10px 6px; white-space: nowrap; }
      .sb-nav ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }

      .sb-link {
        position: relative; display: flex; align-items: center; gap: 12px; width: 100%;
        padding: 10px 12px; border-radius: 11px; border: none; background: transparent;
        color: ${C.text}; text-decoration: none; font: 600 13.5px Inter, sans-serif; cursor: pointer; text-align: left;
        transition: background-color .15s ease, color .15s ease;
      }
      .sb-link:hover { background: rgba(255,255,255,0.06); color: #fff; }
      .sb-link:focus-visible, .sb-collapse:focus-visible, .sb-brand-link:focus-visible, .sb-mobile-toggle:focus-visible {
        outline: 2px solid ${C.accentLight}; outline-offset: 2px;
      }
      .sb-link.is-active {
        background: ${C.accent}; color: #fff;
        box-shadow: 0 10px 22px -12px rgba(28,57,142,0.95), inset 0 1px 0 rgba(255,255,255,0.12);
      }
      .sb-link.is-active::before {
        content: ''; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 4px; border-radius: 0 4px 4px 0; background: ${C.accentLight};
      }
      .sb-icon { flex: 0 0 22px; display: inline-flex; align-items: center; justify-content: center; }
      .sb-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      .sb-footer { padding: 12px; border-top: 1px solid ${C.line}; }
      .sb-signout { color: #FCA5A5; }
      .sb-signout:hover { background: rgba(179,53,43,0.18); color: #FECACA; }
      .sb-signout:disabled { opacity: .6; cursor: wait; }

      /* ── collapsed rail (desktop) ── */
      .is-collapsed .sb-brand { flex-direction: column; gap: 12px; padding: 18px 0 10px; }
      .is-collapsed .sb-brand-link { flex: none; }
      .is-collapsed .sb-brand-text, .is-collapsed .sb-user-text, .is-collapsed .sb-label { display: none; }
      .is-collapsed .sb-collapse { transform: rotate(180deg); }
      .is-collapsed .sb-user { justify-content: center; margin: 2px 12px 10px; padding: 9px 0; }
      .is-collapsed .sb-nav { padding: 4px 12px 12px; }
      .is-collapsed .sb-section { height: 1px; padding: 0; margin: 12px 8px 10px; background: ${C.line}; color: transparent; overflow: hidden; }
      .is-collapsed .sb-group:first-child .sb-section { margin-top: 4px; }
      .is-collapsed .sb-link { justify-content: center; padding: 11px 0; }
      /* hover tooltip with the page name */
      .is-collapsed .sb-link::after {
        content: attr(data-tip); position: fixed; left: calc(var(--sb-w) + 8px); transform: translateY(2px);
        padding: 6px 10px; border-radius: 8px; background: #1A2550; color: #fff; font: 600 12.5px Inter, sans-serif; white-space: nowrap;
        box-shadow: 0 10px 24px -10px rgba(0,0,0,0.7); border: 1px solid rgba(157,187,255,0.25);
        opacity: 0; pointer-events: none; transition: opacity .12s ease;
      }
      .is-collapsed .sb-link:hover::after, .is-collapsed .sb-link:focus-visible::after { opacity: 1; }

      /* ── page area ── */
      .app-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 100vh; }
      .app-main > * { flex: 1 0 auto; }
      /* Pages set min-height:100% on their own wrapper; inside this column that
         percentage is sized without the Go back strip, leaving the layout 58px
         short and the white page background showing below the sidebar. The
         flex rule above already makes each page fill the space. */
      .app-main > *:not(.app-topline) { min-height: 0 !important; }
      body:has(.bukc-app) { background: ${C.navy900}; }
      /* Go back bar: a slim strip above the page, button on the right */
      .app-main > .app-topline { flex: 0 0 auto; display: flex; justify-content: flex-end; align-items: center; padding: 14px 24px 0; min-height: 58px; background: ${C.navy900}; }
      .app-back {
        display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; border-radius: 999px;
        background: transparent; color: #E2E8F0; border: 1.5px solid ${C.muted};
        font: 700 13.5px Inter, sans-serif; cursor: pointer;
        transition: background-color .18s ease, border-color .18s ease, color .18s ease, transform .15s ease;
      }
      .app-back:hover:not(:disabled) { background: rgba(255,255,255,0.08); border-color: #E2E8F0; }
      .app-back:active:not(:disabled) { transform: translateY(1px); }
      .app-back:focus-visible { outline: 2px solid ${C.accentLight}; outline-offset: 2px; }
      .app-back:disabled { opacity: .4; cursor: not-allowed; }

      .sb-mobile-toggle, .sb-backdrop { display: none; }

      /* ── small screens: sidebar becomes a drawer ── */
      @media (max-width: 900px) {
        .bukc-app, .bukc-app.is-collapsed { --sb-w: 288px; }
        .sb { position: fixed; left: 0; top: 0; bottom: 0; height: 100%; transform: translateX(-100%); transition: transform .25s ease; box-shadow: none; }
        .is-mobile-open .sb { transform: translateX(0); box-shadow: 20px 0 50px -10px rgba(0,0,0,0.6); }
        .sb-collapse { display: none; }
        .sb-close { display: inline-flex; }
        /* the drawer always shows full labels */
        .is-collapsed .sb-brand { flex-direction: row; padding: 18px 14px 14px 16px; }
        .is-collapsed .sb-brand-link { flex: 1; }
        .is-collapsed .sb-brand-text, .is-collapsed .sb-user-text { display: flex; }
        .is-collapsed .sb-label { display: inline; }
        .is-collapsed .sb-user { justify-content: flex-start; margin: 2px 14px 10px; padding: 11px 12px; }
        .is-collapsed .sb-section { height: auto; padding: 10px 10px 6px; margin: 0; background: none; color: ${C.dim}; }
        .is-collapsed .sb-link { justify-content: flex-start; padding: 10px 12px; }
        .is-collapsed .sb-link::after { display: none; }
        .sb-mobile-toggle {
          display: inline-flex; position: fixed; top: 12px; left: 12px; z-index: 40; width: 44px; height: 44px;
          align-items: center; justify-content: center; border-radius: 12px; cursor: pointer;
          background: rgba(10,18,41,0.85); color: #fff; border: 1px solid rgba(255,255,255,0.16);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 10px 24px -12px rgba(0,0,0,0.7);
        }
        .is-mobile-open .sb-backdrop { display: block; position: fixed; inset: 0; z-index: 45; background: rgba(3,10,30,0.6); }
        .app-main > .app-topline { min-height: 68px; padding: 12px 14px 0 68px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .sb, .sb-collapse, .sb-link { transition: none !important; }
      }
    `}</style>
  );
}

/* ---------- icons ---------- */
function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function MenuIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>; }
function CloseIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>; }
function CollapseIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="m14 7-5 5 5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><path d="M19 5v14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" /></svg>; }
function SignOutIcon() { return <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
