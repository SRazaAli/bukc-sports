/**
 * Accounts management. Super Admin gets both tabs and full control; Coordinator
 * (AUTH-16: read-only access to all user profiles) gets Active Accounts only,
 * with search but no Pending queue and no deactivate/reactivate/delete actions.
 *  1. Pending Verification (Super Admin only) — review a new registration,
 *     Accept (activates + emails) or Reject (requires a reason, emails).
 *  2. Active Accounts — every account that was genuinely activated at some
 *     point (never a rejected-while-pending application — see the
 *     verified_at filter server-side) across all three roles. AUTH-14 in
 *     practice: deactivate (temporarily, for a chosen duration, or
 *     indefinitely "until reactivated"), reactivate, or permanently delete
 *     (a UI-level delete — see the server's deleteAccountPermanently for why
 *     app_user rows can never be hard-deleted; a deleted account's login
 *     behaves exactly as if it never existed). Debounced live search across
 *     Full Name/Email/Contact plus role-specific fields, matched text
 *     highlighted. Clicking a row opens the full registration detail.
 *
 * Visual design v2: brand-kit backdrop (mint/sky gradient + blobs, Poppins/
 * Inter type, role-tinted accents) plus real interaction upgrades — a live
 * animated stat strip, role pills that double as filters, a list/grid view
 * toggle, skeleton loading states, hover-revealed copy-to-clipboard and
 * quick-view affordances, and a sticky glass nav with Back/Sign out. Frontend
 * only — no API/route/logic changes.
 */
import { useEffect, useState, useCallback, useRef, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  listPending, verifyAccount, rejectAccount, inviteCoordinator, listCoordinatorInvites, deleteCoordinatorInvite,
  listActiveAccounts, searchAccounts, deactivateAccount, reactivateAccount, deleteAccountPermanently,
  type PendingAccount, type ManagedAccount, type CoordinatorInviteRecord,
} from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { LabeledInput, PersonIcon } from './PortalShell.js';
import { palette, ROLE_THEME, type PortalKey } from './AuthUI.js';
import { useAuth } from '../../lib/auth.js';

type Tab = 'pending' | 'active';
type ViewMode = 'list' | 'grid';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

// Map each account role onto the same brand palette used for the four
// landing-page portal tiles, so a role reads consistently everywhere.
const ROLE_PORTAL_KEY: Partial<Record<string, PortalKey>> = {
  STUDENT: 'student',
  EXTERNAL: 'external',
  COORDINATOR: 'coordinator',
  SUPER_ADMIN: 'admin',
};
function roleTheme(role: string) {
  return ROLE_THEME[ROLE_PORTAL_KEY[role] ?? 'coordinator'];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = (parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : parts[0]?.[1] ?? '');
  return chars.toUpperCase() || '?';
}

// Smoothly animates a number toward its latest target — used by the stat
// strip so the counters visibly tick when a filter or search narrows results.
function useCountUp(target: number) {
  const [display, setDisplay] = useState(target);
  useEffect(() => {
    let frame: number;
    const duration = 420;
    const start = performance.now();
    const startVal = display;
    function step(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(startVal + (target - startVal) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return display;
}

export default function AdminAccountsScreen() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const theme = roleTheme(user?.role ?? 'COORDINATOR');
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<PendingAccount[] | null>(null);
  const [selected, setSelected] = useState<PendingAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshPending() {
    setError(null);
    try {
      const res = await listPending();
      setPending(res.accounts);
    } catch (err) {
      setError(errMsg(err));
    }
  }
  useEffect(() => { if (isSuperAdmin) void refreshPending(); }, [isSuperAdmin]);

  async function onAccept(a: PendingAccount) {
    setError(null); setNotice(null);
    try {
      await verifyAccount(a.userId);
      setNotice(`${a.fullName}'s account has been activated. They have been notified by email.`);
      setSelected(null);
      await refreshPending();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function onReject(a: PendingAccount, reason: string) {
    setError(null); setNotice(null);
    try {
      await rejectAccount(a.userId, reason);
      setNotice(`${a.fullName}'s application was rejected. They have been notified by email.`);
      setSelected(null);
      await refreshPending();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="acc-ui" style={s.page}>
      <AccStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />

      <header style={s.topbar}>
        <div style={s.brand}>
          <span style={{ ...s.logoMark, background: theme.solid }}>BU</span>
          <span style={s.wordmark}>Bahria University</span>
        </div>
        <div style={s.topbarRight}>
          <Link to="/home" className="hist-topbtn" style={s.topBtn}><BackIcon /> Back</Link>
          <button type="button" className="hist-topbtn hist-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
            <SignOutIcon /> Sign out
          </button>
        </div>
      </header>

      <div style={s.hero}>
        <span style={{ ...s.heroEyebrow, color: isSuperAdmin ? palette.navy : palette.teal, background: isSuperAdmin ? palette.sky100 : palette.mint100 }}>
          {isSuperAdmin ? <ShieldIcon /> : <EyeIcon />}
          {isSuperAdmin ? 'Administration Staff' : 'Read-only Access'}
        </span>
        <h1 style={s.heroTitle}>Accounts</h1>
        <p style={s.heroSubtitle}>
          {isSuperAdmin
            ? 'Review new registrations and manage every account across the platform.'
            : 'Browse every verified account across the platform. You can search and open a profile, but not make changes here.'}
        </p>
      </div>

      <main style={s.main}>
        {isSuperAdmin && (
          <div style={s.tabRow} role="tablist">
            {(['pending', 'active'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className="acc-tab"
                onClick={() => { setTab(t); setError(null); setNotice(null); setSelected(null); }}
                style={{ ...s.tabBtn, ...(tab === t ? s.tabActive : null) }}>
                {t === 'pending' ? 'Pending Verification' : 'Active Accounts'}
                {t === 'pending' && pending && pending.length > 0 && (
                  <span style={s.tabCount}>{pending.length}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {error && <div className="acc-toast" style={s.banner.error}><AlertIcon /> {error}</div>}
        {notice && <div className="acc-toast" style={s.banner.ok}><CheckIcon /> {notice}</div>}

        {isSuperAdmin && tab === 'pending' ? (
          selected ? (
            <ReviewPanel
              account={selected}
              onBack={() => setSelected(null)}
              onAccept={() => onAccept(selected)}
              onReject={(reason) => onReject(selected, reason)}
            />
          ) : (
            <>
              <Panel title="Pending Verification" icon={<QueueIcon />}>
                {pending === null ? (
                  <SkeletonRows rows={3} />
                ) : pending.length === 0 ? (
                  <EmptyState icon={<CheckIcon />} text="No accounts are awaiting verification. New registrations appear here." />
                ) : (
                  <div style={s.tableWrap}>
                    <table style={s.table}>
                      <thead>
                        <tr><th style={s.th}>Name</th><th style={s.th}>Email</th><th style={s.th}>Type</th><th style={s.th} /></tr>
                      </thead>
                      <tbody>
                        {pending.map((a, i) => {
                          const theme = roleTheme(a.role);
                          return (
                            <tr key={a.userId} className="acc-row acc-row-anim" style={{ animationDelay: `${i * 35}ms` }}>
                              <td style={s.td}>
                                <div style={s.nameCell}>
                                  <Avatar name={a.fullName} theme={theme} />
                                  <span style={s.nameText}>{a.fullName}</span>
                                </div>
                              </td>
                              <td style={s.td}>{a.email}</td>
                              <td style={s.td}><RoleBadge role={a.role} theme={theme} /></td>
                              <td style={{ ...s.td, textAlign: 'right' }}>
                                <button style={s.reviewBtn} className="acc-btn" onClick={() => setSelected(a)}>Review</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <InviteCoordinator onDone={setNotice} onError={setError} />
              <CoordinatorInviteLog onError={setError} />
            </>
          )
        ) : (
          <ActiveAccountsTab onError={setError} onNotice={setNotice} readOnly={!isSuperAdmin} />
        )}
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
      </footer>
    </div>
  );
}

function AccStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
      .acc-ui { font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; }
      .acc-ui h1 { font-family: 'Poppins', 'Segoe UI', system-ui, sans-serif; }
      .acc-card { animation: accFadeUp .45s ease both; }
      @keyframes accFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      .acc-row { transition: background-color .15s ease; cursor: pointer; }
      .acc-row:hover { background: ${palette.mint50}; }
      .acc-row-anim { opacity: 0; animation: accRowIn .35s ease forwards; }
      @keyframes accRowIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
      .acc-tab { transition: background-color .15s ease, color .15s ease, box-shadow .15s ease; }
      .acc-btn { transition: transform .15s ease, box-shadow .15s ease, filter .15s ease, background-color .15s ease, border-color .15s ease, color .15s ease; }
      .acc-btn:hover { transform: translateY(-1px); filter: brightness(1.04); }
      .acc-btn:active { transform: translateY(0); }
      .acc-input { transition: border-color .15s ease, box-shadow .15s ease; }
      .acc-input:focus, .acc-select:focus { outline: none; border-color: ${palette.teal}; box-shadow: 0 0 0 4px rgba(73,132,115,0.15); }
      .acc-modal-anim { animation: accPop .2s ease both; }
      @keyframes accPop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .acc-toast { animation: accToast .3s ease both; }
      @keyframes accToast { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      .acc-reveal { opacity: 0; transform: translateX(-4px); transition: opacity .15s ease, transform .15s ease; }
      .acc-row:hover .acc-reveal, .acc-card-tile:hover .acc-reveal { opacity: 1; transform: translateX(0); }
      .acc-card-tile { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; cursor: pointer; }
      .acc-card-tile:hover { transform: translateY(-3px); box-shadow: 0 18px 34px -18px rgba(11,55,84,0.35); border-color: transparent; }
      .acc-chip { transition: background-color .15s ease, color .15s ease, border-color .15s ease, transform .1s ease; }
      .acc-chip:hover { transform: translateY(-1px); }
      .acc-stat { transition: transform .18s ease, box-shadow .18s ease; }
      .acc-stat:hover { transform: translateY(-2px); box-shadow: 0 14px 26px -16px rgba(11,55,84,0.3); }
      .acc-skel { position: relative; overflow: hidden; background: ${palette.line}; }
      .acc-skel::after {
        content: ''; position: absolute; inset: 0; transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent);
        animation: accShimmer 1.3s ease-in-out infinite;
      }
      @keyframes accShimmer { 100% { transform: translateX(100%); } }
      .acc-avatar-wrap:hover .acc-avatar-img { transform: scale(1.06); }
      .acc-avatar-img { transition: transform .18s ease; }
      @media (max-width: 720px) {
        .acc-hide-mobile { display: none !important; }
        .acc-table-wrap { overflow-x: auto; }
        .acc-grid-mq { grid-template-columns: 1fr !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .acc-card, .acc-row-anim, .acc-toast, .acc-modal-anim { animation: none !important; opacity: 1 !important; }
      }
    `}</style>
  );
}

// ─────────────────────────── ACTIVE ACCOUNTS ───────────────────────────

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const MIN_SEARCH_CHARS = 2;
const LIVE_LIMIT = 10;
const FULL_LIMIT = 100;
const ROLE_FILTERS: Array<{ value: '' | ManagedAccount['role']; label: string }> = [
  { value: '', label: 'All roles' },
  { value: 'STUDENT', label: 'Student' },
  { value: 'EXTERNAL', label: 'External' },
  { value: 'COORDINATOR', label: 'Coordinator' },
];

function ActiveAccountsTab({ onError, onNotice, readOnly }: { onError: (m: string) => void; onNotice: (m: string) => void; readOnly: boolean }) {
  const [accounts, setAccounts] = useState<ManagedAccount[] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | ManagedAccount['role']>('');
  const [limit, setLimit] = useState(LIVE_LIMIT);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const [viewing, setViewing] = useState<ManagedAccount | null>(null);
  const [deactivating, setDeactivating] = useState<ManagedAccount | null>(null);
  const [deleting, setDeleting] = useState<ManagedAccount | null>(null);
  const debouncedTerm = useDebouncedValue(searchTerm, 350);
  const abortRef = useRef<AbortController | null>(null);
  const activeSearchTerm = debouncedTerm.trim().length >= MIN_SEARCH_CHARS ? debouncedTerm.trim() : '';

  const load = useCallback(async () => {
    abortRef.current?.abort();
    setLoading(true);
    try {
      if (activeSearchTerm) {
        const controller = new AbortController();
        abortRef.current = controller;
        const res = await searchAccounts(activeSearchTerm, roleFilter || undefined, limit, controller.signal);
        setAccounts(res.accounts);
      } else {
        const res = await listActiveAccounts(roleFilter || undefined);
        setAccounts(res.accounts);
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) onError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [activeSearchTerm, roleFilter, limit, onError]);

  useEffect(() => { void load(); }, [load]);
  // Reset to the capped live-typing limit whenever the term actually changes.
  useEffect(() => { setLimit(LIVE_LIMIT); }, [activeSearchTerm]);

  async function handleReactivate(a: ManagedAccount) {
    try {
      await reactivateAccount(a.userId);
      onNotice(`${a.fullName}'s account has been reactivated. They have been notified by email.`);
      void load();
    } catch (e) { onError(errMsg(e)); }
  }

  const total = accounts?.length ?? 0;
  const activeCount = accounts?.filter((a) => a.status === 'ACTIVE').length ?? 0;
  const deactivatedCount = total - activeCount;
  const lockedCount = accounts?.filter((a) => a.lockedUntil).length ?? 0;
  const animTotal = useCountUp(total);
  const animActive = useCountUp(activeCount);
  const animDeactivated = useCountUp(deactivatedCount);
  const animLocked = useCountUp(lockedCount);

  return (
    <Panel title="Active Accounts" icon={<PeopleIcon />} subtitle={`${total} shown${roleFilter ? ` · ${roleFilter.toLowerCase()}` : ''}`}>
      <div style={s.statRow}>
        <StatCard label="Total shown" value={animTotal} accent={palette.navy} icon={<PeopleIcon />} />
        <StatCard label="Active" value={animActive} accent={palette.teal} icon={<CheckIcon />} />
        <StatCard label="Deactivated" value={animDeactivated} accent="#c0392b" icon={<AlertIcon />} />
        <StatCard label="Locked" value={animLocked} accent="#9a6412" icon={<LockDotIcon />} />
      </div>

      <div style={s.searchRow}>
        <div style={s.searchBox}>
          <span style={s.searchIcon}><SearchIcon /></span>
          <input
            type="search" className="acc-input" style={s.searchInput} value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setLimit(FULL_LIMIT); }}
            placeholder="Search by name, email, contact number, enrollment, institution…"
          />
        </div>
        <div style={s.viewToggle} role="group" aria-label="View mode">
          <button type="button" className="acc-btn" aria-pressed={view === 'list'}
            style={{ ...s.viewToggleBtn, ...(view === 'list' ? s.viewToggleBtnActive : null) }}
            onClick={() => setView('list')} title="List view">
            <ListIcon />
          </button>
          <button type="button" className="acc-btn" aria-pressed={view === 'grid'}
            style={{ ...s.viewToggleBtn, ...(view === 'grid' ? s.viewToggleBtnActive : null) }}
            onClick={() => setView('grid')} title="Grid view">
            <GridIcon />
          </button>
        </div>
      </div>

      <div style={s.chipRow}>
        {ROLE_FILTERS.map((f) => {
          const active = roleFilter === f.value;
          const theme = f.value ? roleTheme(f.value) : null;
          return (
            <button
              key={f.value || 'all'}
              type="button"
              className="acc-btn acc-chip"
              onClick={() => setRoleFilter(f.value)}
              style={{
                ...s.filterChip,
                ...(active
                  ? { background: theme ? theme.solid : palette.navy, color: '#fff', borderColor: 'transparent' }
                  : {}),
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {searchTerm.trim().length > 0 && searchTerm.trim().length < MIN_SEARCH_CHARS && (
        <p style={s.hintMuted}>Type at least {MIN_SEARCH_CHARS} characters to search.</p>
      )}

      {accounts === null ? (
        view === 'grid' ? <SkeletonGrid /> : <SkeletonRows rows={4} />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          text={activeSearchTerm ? `No matching accounts for "${activeSearchTerm}".` : 'No active or deactivated accounts yet.'}
          action={activeSearchTerm || roleFilter ? { label: 'Clear filters', onClick: () => { setSearchTerm(''); setRoleFilter(''); } } : undefined}
        />
      ) : view === 'grid' ? (
        <>
          <div className="acc-grid-mq" style={s.cardGrid}>
            {accounts.map((a, i) => {
              const theme = roleTheme(a.role);
              return (
                <div key={a.userId} className="acc-card-tile acc-row-anim" style={{ ...s.accountCard, animationDelay: `${i * 30}ms` }} onClick={() => setViewing(a)}>
                  <div style={s.accountCardTop}>
                    <Avatar name={a.fullName} theme={theme} size={44} />
                    <span className="acc-reveal" style={s.cardArrow}><ArrowRightIcon /></span>
                  </div>
                  <div style={s.nameText}>{a.fullName}</div>
                  <div style={s.subText}>{a.email}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
                    <RoleBadge role={a.role} theme={theme} />
                    <StatusDisplay a={a} />
                  </div>
                  <div style={s.cardFooterRow}>
                    <span style={s.subText}>{a.contactNumber}</span>
                    {!readOnly && (
                      <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                        {a.status === 'ACTIVE' ? (
                          <button className="acc-btn" style={s.linkBtn} onClick={() => setDeactivating(a)}>Deactivate</button>
                        ) : (
                          <button className="acc-btn" style={s.linkBtn} onClick={() => handleReactivate(a)}>Reactivate</button>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {activeSearchTerm && accounts.length >= limit && limit < FULL_LIMIT && (
            <button className="acc-btn" style={s.showMoreBtn} onClick={() => setLimit(FULL_LIMIT)}>Show all results</button>
          )}
          {loading && <p style={s.hintMuted}>Updating…</p>}
        </>
      ) : (
        <>
          <div className="acc-table-wrap" style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Name</th><th style={s.th}>Role</th><th className="acc-hide-mobile" style={s.th}>Contact</th>
                  <th style={s.th}>Status</th><th style={s.th} />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a, i) => {
                  const theme = roleTheme(a.role);
                  return (
                    <tr key={a.userId} className="acc-row acc-row-anim" style={{ animationDelay: `${i * 30}ms` }} onClick={() => setViewing(a)}>
                      <td style={s.td}>
                        <div style={s.nameCell}>
                          <Avatar name={a.fullName} theme={theme} />
                          <div>
                            <div style={s.nameText}><Highlight text={a.fullName} term={activeSearchTerm} /></div>
                            <div style={s.subText}><Highlight text={a.email} term={activeSearchTerm} /></div>
                            {a.enrollmentNo && <div style={s.subText}>Enrollment: <Highlight text={a.enrollmentNo} term={activeSearchTerm} /></div>}
                            {a.institutionName && <div style={s.subText}><Highlight text={a.institutionName} term={activeSearchTerm} /></div>}
                          </div>
                        </div>
                      </td>
                      <td style={s.td}><RoleBadge role={a.role} theme={theme} /></td>
                      <td className="acc-hide-mobile" style={s.td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Highlight text={a.contactNumber} term={activeSearchTerm} />
                          <span className="acc-reveal"><CopyButton value={a.contactNumber} /></span>
                        </span>
                      </td>
                      <td style={s.td}><StatusDisplay a={a} /></td>
                      <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        {!readOnly && (
                          <>
                            {a.status === 'ACTIVE' ? (
                              <button className="acc-btn" style={s.linkBtn} onClick={() => setDeactivating(a)}>Deactivate</button>
                            ) : (
                              <button className="acc-btn" style={s.linkBtn} onClick={() => handleReactivate(a)}>Reactivate</button>
                            )}
                            <button className="acc-btn" style={{ ...s.linkBtn, color: '#c0392b' }} onClick={() => setDeleting(a)}>Delete</button>
                          </>
                        )}
                        <span className="acc-reveal" style={s.rowChevron} onClick={() => setViewing(a)}><ChevronRightIcon /></span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {activeSearchTerm && accounts.length >= limit && limit < FULL_LIMIT && (
            <button className="acc-btn" style={s.showMoreBtn} onClick={() => setLimit(FULL_LIMIT)}>Show all results</button>
          )}
          {loading && <p style={s.hintMuted}>Updating…</p>}
        </>
      )}

      {viewing && <AccountDetailModal account={viewing} onClose={() => setViewing(null)} />}

      {deactivating && (
        <DeactivateModal
          account={deactivating}
          onCancel={() => setDeactivating(null)}
          onConfirm={async (durationMinutes) => {
            try {
              await deactivateAccount(deactivating.userId, durationMinutes);
              onNotice(`${deactivating.fullName}'s account has been deactivated. They have been notified by email.`);
              setDeactivating(null);
              void load();
            } catch (e) { onError(errMsg(e)); setDeactivating(null); }
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          title="Delete Account"
          message={`This permanently removes ${deleting.fullName}'s account. It will disappear from every list, and signing in with their credentials will behave exactly as if the account never existed. This cannot be undone from the UI. They will be notified by email.`}
          confirmLabel="Delete Permanently"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deleteAccountPermanently(deleting.userId);
              onNotice(`${deleting.fullName}'s account has been deleted. They have been notified by email.`);
              setDeleting(null);
              void load();
            } catch (e) { onError(errMsg(e)); setDeleting(null); }
          }}
        />
      )}
    </Panel>
  );
}

function StatCard({ label, value, accent, icon }: { label: string; value: number; accent: string; icon: ReactNode }) {
  return (
    <div className="acc-stat" style={s.statCard}>
      <span style={{ ...s.statIcon, color: accent, background: `${accent}1a` }}>{icon}</span>
      <div>
        <div style={{ ...s.statValue, color: accent }}>{value}</div>
        <div style={s.statLabel}>{label}</div>
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="acc-btn"
      style={s.copyBtn}
      title={copied ? 'Copied!' : 'Copy'}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 1300);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function Avatar({ name, theme, size = 36 }: { name: string; theme: { from: string; to: string }; size?: number }) {
  return (
    <span className="acc-avatar-wrap" style={{ display: 'inline-flex' }}>
      <span className="acc-avatar-img" style={{ ...s.avatar, width: size, height: size, minWidth: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${theme.from}, ${theme.to})` }}>
        {initials(name)}
      </span>
    </span>
  );
}

function RoleBadge({ role, theme }: { role: string; theme: { solid: string; soft: string } }) {
  return <span style={{ ...s.roleBadge, color: theme.solid, background: theme.soft }}>{role.replace('_', ' ')}</span>;
}

// Active/Deactivated status, plus a separate "Locked" badge (AUTH-11) when
// applicable — a locked account is still ACTIVE from the account-management
// point of view, this is purely "too many recent wrong password attempts,
// temporarily can't log in," so it's shown alongside the status rather than
// replacing it. Hover for the explanation and exact unlock time.
function StatusDisplay({ a }: { a: ManagedAccount }) {
  return (
    <>
      {a.status === 'ACTIVE' ? (
        <span style={s.statusBadge.active}><span style={s.statusDot.active} />Active</span>
      ) : (
        <span style={s.statusBadge.deactivated}>
          <span style={s.statusDot.deactivated} />
          Deactivated{a.deactivatedUntil ? ` until ${new Date(a.deactivatedUntil).toLocaleString()}` : ' (indefinite)'}
        </span>
      )}
      {a.lockedUntil && (
        <span
          style={s.statusBadge.locked}
          title={`Temporarily locked after repeated failed login attempts. Unlocks automatically at ${new Date(a.lockedUntil).toLocaleString()}.`}
        >
          Locked
        </span>
      )}
    </>
  );
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return <>{text.slice(0, idx)}<mark style={s.markStyle}>{text.slice(idx, idx + term.length)}</mark>{text.slice(idx + term.length)}</>;
}

// Full registration-time detail for one account — the same fields captured
// on the original registration form, already present on ManagedAccount from
// the list/search join, so this needs no extra fetch.
function AccountDetailModal({ account: a, onClose }: { account: ManagedAccount; onClose: () => void }) {
  const rows: Array<[string, string | undefined, boolean?]> = a.role === 'STUDENT'
    ? [
      ['Full Name', a.fullName], ['Email', a.email, true], ['Contact', a.contactNumber, true],
      ['Enrollment', a.enrollmentNo], ['Department', a.department], ['Program', a.programTitle],
    ]
    : a.role === 'EXTERNAL'
      ? [
        ['Full Name', a.fullName], ['Email', a.email, true], ['Contact', a.contactNumber, true],
        ['Institution', a.institutionName], ['Designation', a.designation],
      ]
      : [
        ['Full Name', a.fullName], ['Email', a.email, true], ['Contact', a.contactNumber, true],
      ];
  const theme = roleTheme(a.role);

  return (
    <Modal title="Account Details" onClose={onClose}>
      <div style={s.modalIdentity}>
        <Avatar name={a.fullName} theme={theme} size={48} />
        <div>
          <div style={{ fontWeight: 700, color: palette.ink, fontSize: 15.5 }}>{a.fullName}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <RoleBadge role={a.role} theme={theme} /> <StatusDisplay a={a} />
          </div>
        </div>
      </div>
      {rows.map(([label, value, copyable]) => (
        <div key={label} style={s.detailRow}>
          <div style={s.detailLabel}>{label}</div>
          <div style={{ ...s.detailValue, display: 'flex', alignItems: 'center', gap: 6 }}>
            {value ?? '—'}
            {copyable && value && <CopyButton value={value} />}
          </div>
        </div>
      ))}
      <div style={s.detailRow}>
        <div style={s.detailLabel}>Account created</div>
        <div style={s.detailValue}>{new Date(a.createdAt).toLocaleString()}</div>
      </div>
      {a.deactivatedAt && (
        <div style={s.detailRow}>
          <div style={s.detailLabel}>Deactivated on</div>
          <div style={s.detailValue}>{new Date(a.deactivatedAt).toLocaleString()}</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="acc-btn" style={s.secondaryBtn} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

// ── Deactivate modal: presets, custom (days/hours/minutes), or indefinite ──
const PRESETS: Array<{ label: string; minutes: number }> = [
  { label: '10 minutes', minutes: 10 },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '7 days', minutes: 10080 },
];

function DeactivateModal({ account, onCancel, onConfirm }: {
  account: ManagedAccount; onCancel: () => void; onConfirm: (durationMinutes?: number) => void;
}) {
  const [mode, setMode] = useState<'preset' | 'custom' | 'indefinite'>('preset');
  const [presetMinutes, setPresetMinutes] = useState(PRESETS[1]!.minutes);
  const [days, setDays] = useState(0);
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);

  const customMinutes = days * 1440 + hours * 60 + minutes;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'indefinite') { onConfirm(undefined); return; }
    if (mode === 'preset') { onConfirm(presetMinutes); return; }
    if (customMinutes <= 0) return;
    onConfirm(customMinutes);
  }

  return (
    <Modal title={`Deactivate — ${account.fullName}`} onClose={onCancel}>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 14 }}>
          <label style={s.radioRow}>
            <input type="radio" checked={mode === 'preset'} onChange={() => setMode('preset')} />
            <span>For a preset duration</span>
          </label>
          {mode === 'preset' && (
            <div style={s.presetGrid}>
              {PRESETS.map((p) => (
                <button key={p.minutes} type="button" className="acc-btn"
                  style={{ ...s.presetChip, ...(presetMinutes === p.minutes ? s.presetChipActive : {}) }}
                  onClick={() => setPresetMinutes(p.minutes)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={s.radioRow}>
            <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} />
            <span>Custom duration</span>
          </label>
          {mode === 'custom' && (
            <div style={s.customRow}>
              <NumField label="Days" value={days} onChange={setDays} />
              <NumField label="Hours" value={hours} onChange={setHours} max={23} />
              <NumField label="Minutes" value={minutes} onChange={setMinutes} max={59} />
            </div>
          )}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={s.radioRow}>
            <input type="radio" checked={mode === 'indefinite'} onChange={() => setMode('indefinite')} />
            <span>Until I reactivate it</span>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="acc-btn" style={s.secondaryBtn} onClick={onCancel}>Cancel</button>
          <button type="submit" className="acc-btn" style={s.dangerBtn} disabled={mode === 'custom' && customMinutes <= 0}>Deactivate</button>
        </div>
      </form>
    </Modal>
  );
}

function NumField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <div>
      <span style={s.numFieldLabel}>{label}</span>
      <input type="number" min={0} max={max} className="acc-input" style={s.numFieldInput} value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max ?? 9999, Number(e.target.value) || 0)))} />
    </div>
  );
}

// ── Shared small modal primitives ──
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="acc-modal-anim" style={s.modalBox} onMouseDown={(e) => e.stopPropagation()}>
        <div style={s.modalHead}><span>{title}</span><button type="button" onClick={onClose} style={s.closeBtn} aria-label="Close">×</button></div>
        <div style={s.modalBody}>{children}</div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: palette.muted, lineHeight: 1.55 }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={onCancel} className="acc-btn" style={s.secondaryBtn}>Cancel</button>
        <button type="button" onClick={onConfirm} className="acc-btn" style={danger ? s.dangerBtn : s.reviewBtn}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// ─────────────────────────── PENDING (unchanged logic) ───────────────────────────

function ReviewPanel({
  account, onBack, onAccept, onReject,
}: { account: PendingAccount; onBack: () => void; onAccept: () => void; onReject: (reason: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const a = account;
  const theme = roleTheme(a.role);

  const rows: Array<[string, string | undefined]> = a.role === 'STUDENT'
    ? [
      ['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber],
      ['Enrollment', a.enrollmentNo], ['Department', a.department], ['Program', a.programTitle],
    ]
    : [
      ['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber],
      ['Institution', a.institutionName], ['Designation', a.designation],
    ];

  return (
    <Panel title={`Review ${a.role === 'STUDENT' ? 'Student' : 'External'} Application`} icon={<QueueIcon />}>
      <div style={s.modalIdentity}>
        <Avatar name={a.fullName} theme={theme} />
        <div style={{ fontWeight: 700, color: palette.ink, fontSize: 15.5 }}>{a.fullName}</div>
      </div>
      <div style={{ marginBottom: 20 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={s.detailRow}>
            <div style={s.detailLabel}>{label}</div>
            <div style={s.detailValue}>{value ?? '—'}</div>
          </div>
        ))}
      </div>

      {!rejecting ? (
        <div style={s.actionRow}>
          <button className="acc-btn" style={s.acceptBtn} onClick={onAccept}>Accept &amp; Activate</button>
          <button className="acc-btn" style={s.rejectBtn} onClick={() => setRejecting(true)}>Reject…</button>
          <button className="acc-btn" style={s.backBtn} onClick={onBack}>Back to queue</button>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <label style={s.detailLabel}>Reason for rejection (emailed to the applicant)</label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="e.g. Enrollment number does not match our records."
            className="acc-input" style={s.textarea}
          />
          <div style={s.actionRow}>
            <button
              className="acc-btn" style={{ ...s.rejectBtn, opacity: reason.trim() ? 1 : 0.5 }}
              disabled={!reason.trim()}
              onClick={() => onReject(reason.trim())}
            >
              Confirm rejection
            </button>
            <button className="acc-btn" style={s.backBtn} onClick={() => { setRejecting(false); setReason(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function InviteCoordinator({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await inviteCoordinator({ fullName, email, contactNumber });
      onDone(`Invitation sent to ${email}.`);
      setFullName(''); setEmail(''); setContactNumber('');
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Invite a Coordinator" icon={<PersonIcon />}>
      <p style={{ ...s.muted, marginTop: 0 }}>
        The coordinator receives an email link to set their own password. You never handle their password.
      </p>
      <form onSubmit={onSubmit} noValidate style={{ maxWidth: 420 }}>
        <LabeledInput label="Full name:" icon={<PersonIcon />} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <LabeledInput label="Email:" icon={<PersonIcon />} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <LabeledInput label="Contact number:" icon={<PersonIcon />} value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} required />
        <button type="submit" className="acc-btn" style={{ ...s.primaryBtn, ...(loading ? s.primaryBtnDisabled : null) }} disabled={loading}>
          {loading ? 'Sending…' : 'Send Invitation'}
        </button>
      </form>
    </Panel>
  );
}

// Audit trail — every coordinator invite ever sent, for the record, whether
// accepted, still pending, or expired unused.
function CoordinatorInviteLog({ onError }: { onError: (m: string) => void }) {
  const [invites, setInvites] = useState<CoordinatorInviteRecord[] | null>(null);
  const [deleting, setDeleting] = useState<CoordinatorInviteRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedTerm = useDebouncedValue(searchTerm, 350);
  const activeSearchTerm = debouncedTerm.trim().length >= MIN_SEARCH_CHARS ? debouncedTerm.trim() : '';

  const load = useCallback(async () => {
    try { const res = await listCoordinatorInvites(); setInvites(res.invites); }
    catch (e) { onError(errMsg(e)); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  const filtered = invites?.filter((i) => {
    if (!activeSearchTerm) return true;
    const term = activeSearchTerm.toLowerCase();
    return i.fullName.toLowerCase().includes(term)
      || i.email.toLowerCase().includes(term)
      || i.invitedByName.toLowerCase().includes(term);
  }) ?? null;

  return (
    <Panel title="Coordinator Invitations Sent" icon={<MailIcon />}>
      {invites !== null && invites.length > 0 && (
        <div style={s.searchRow}>
          <div style={s.searchBox}>
            <span style={s.searchIcon}><SearchIcon /></span>
            <input className="acc-input" style={s.searchInput} placeholder="Search by name or email…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>
      )}
      {activeSearchTerm && filtered?.length === 0 && <p style={s.hintMuted}>No invitations match "{activeSearchTerm}".</p>}
      {filtered === null ? (
        <SkeletonRows rows={2} />
      ) : filtered.length === 0 && !activeSearchTerm ? (
        <EmptyState icon={<MailIcon />} text="No coordinator invitations have been sent yet." />
      ) : filtered.length > 0 ? (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr><th style={s.th}>Name</th><th style={s.th}>Email</th><th className="acc-hide-mobile" style={s.th}>Invited By</th><th className="acc-hide-mobile" style={s.th}>Sent</th><th style={s.th}>Status</th><th style={s.th} /></tr>
            </thead>
            <tbody>
              {filtered.map((i, idx) => (
                <tr key={i.inviteId} className="acc-row acc-row-anim" style={{ animationDelay: `${idx * 30}ms` }}>
                  <td style={s.td}><Highlight text={i.fullName} term={activeSearchTerm} /></td>
                  <td style={s.td}><Highlight text={i.email} term={activeSearchTerm} /></td>
                  <td className="acc-hide-mobile" style={s.td}><Highlight text={i.invitedByName} term={activeSearchTerm} /></td>
                  <td className="acc-hide-mobile" style={s.td}>{new Date(i.issuedAt).toLocaleString()}</td>
                  <td style={s.td}><span style={{ ...s.roleBadge, ...inviteStatusStyle(i.status) }}>{i.status}</span></td>
                  <td style={{ ...s.td, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <button className="acc-btn" style={{ ...s.linkBtn, color: '#c0392b' }} onClick={() => setDeleting(i)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {deleting && (
        <ConfirmModal
          title="Delete Invite Record"
          danger
          confirmLabel="Delete Permanently"
          message={`This permanently removes the invite record for ${deleting.fullName} (${deleting.email}) from the log. This is a hard delete — it cannot be undone. It does NOT affect their account if they already accepted the invite.`}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await deleteCoordinatorInvite(deleting.inviteId);
              setDeleting(null);
              void load();
            } catch (e) { onError(errMsg(e)); setDeleting(null); }
          }}
        />
      )}
    </Panel>
  );
}

function inviteStatusStyle(status: CoordinatorInviteRecord['status']): React.CSSProperties {
  if (status === 'ACCEPTED') return { background: palette.mint100, color: palette.tealDeep };
  if (status === 'EXPIRED') return { background: '#fbe9e7', color: '#b3352b' };
  return { background: '#fdf1e3', color: '#9a6412' };
}

function Panel({ title, icon, subtitle, children }: { title: string; icon?: ReactNode; subtitle?: string; children: ReactNode }) {
  return (
    <section className="acc-card" style={s.panel}>
      <div style={s.panelHead}>
        <span style={s.panelHeadLeft}>
          {icon && <span style={s.panelIcon}>{icon}</span>}
          <span>{title}</span>
        </span>
        {subtitle && <span style={s.panelSubtitle}>{subtitle}</span>}
      </div>
      <div style={s.panelBody}>{children}</div>
    </section>
  );
}

function EmptyState({ icon, text, action }: { icon: ReactNode; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={s.emptyState}>
      <span style={s.emptyIcon}>{icon}</span>
      <p style={{ ...s.muted, margin: 0 }}>{text}</p>
      {action && <button type="button" className="acc-btn" style={s.secondaryBtn} onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={s.skeletonRow}>
          <span className="acc-skel" style={s.skeletonAvatar} />
          <div style={{ flex: 1 }}>
            <span className="acc-skel" style={{ ...s.skeletonLine, width: '38%' }} />
            <span className="acc-skel" style={{ ...s.skeletonLine, width: '55%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="acc-grid-mq" style={s.cardGrid}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ ...s.accountCard, cursor: 'default' }}>
          <span className="acc-skel" style={s.skeletonAvatar} />
          <span className="acc-skel" style={{ ...s.skeletonLine, width: '70%', marginTop: 12 }} />
          <span className="acc-skel" style={{ ...s.skeletonLine, width: '50%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

/* ---------- small icons ---------- */
function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SearchIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m20 20-3.6-3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>; }
function EyeIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" /></svg>; }
function ShieldIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>; }
function PeopleIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" /><path d="M3 20c.8-3.2 3-5 6-5s5.2 1.8 6 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="17" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.5" /><path d="M15.5 12.2c2.4.3 4 1.8 4.5 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }
function QueueIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M4 6.5h16M4 12h16M4 17.5h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>; }
function MailIcon() { return <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" /><path d="m3.5 6 8.5 6.5L20.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function AlertIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3.5 21.5 20h-19L12 3.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M12 10v4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="17" r="0.9" fill="currentColor" /></svg>; }
function CheckIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.7" /><path d="m8 12.3 2.6 2.6L16.3 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function LockDotIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="5" y="10.5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="15.5" r="1.3" fill="currentColor" /></svg>; }
function CopyIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>; }
function ListIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="3.5" cy="6" r="1.4" fill="currentColor" /><circle cx="3.5" cy="12" r="1.4" fill="currentColor" /><circle cx="3.5" cy="18" r="1.4" fill="currentColor" /></svg>; }
function GridIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.7" /><rect x="13" y="13" width="7.5" height="7.5" rx="1.5" stroke="currentColor" strokeWidth="1.7" /></svg>; }
function ArrowLeftIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 8H3M7 4 3 8l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ArrowRightIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ChevronRightIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

/* ---------- style tokens (on-palette rebuild) ---------- */
const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1200px 600px at 10% -10%, ${palette.sky100} 0%, transparent 55%),
                 radial-gradient(1000px 600px at 100% 0%, ${palette.mint100} 0%, transparent 55%),
                 ${palette.mint50}`,
  } as const,
  blobA: { position: 'absolute', width: 320, height: 320, borderRadius: '50%', background: `${palette.teal}1f`, top: -130, left: -100, filter: 'blur(10px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: `${palette.navy}18`, bottom: -140, right: -100, filter: 'blur(10px)', pointerEvents: 'none' } as const,

  topbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 32px',
    borderBottom: `1px solid ${palette.line}`,
  } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 10 } as const,
  logoMark: { width: 32, height: 32, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: palette.navy, color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 13 } as const,
  wordmark: { fontFamily: 'Poppins, serif', fontSize: 18, fontWeight: 600, color: palette.navy } as const,
  topbarTag: { fontSize: 13, color: palette.muted, fontWeight: 500 } as const,
  topbarActions: { display: 'flex', alignItems: 'center', gap: 10 } as const,
  ghostBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: palette.navy, border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const,
  signOutBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: '#8f2323', border: '1.5px solid #f3caca', borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const,

  hero: { textAlign: 'center', maxWidth: 620, margin: '36px auto 8px', padding: '0 24px', position: 'relative' } as const,
  heroEyebrow: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '6px 14px', borderRadius: 999, marginBottom: 14 } as const,
  heroTitle: { fontFamily: 'Poppins, sans-serif', fontSize: 32, fontWeight: 700, color: palette.navy, margin: '0 0 8px' } as const,
  heroSubtitle: { fontSize: 14.5, lineHeight: 1.55, color: palette.muted, margin: 0 } as const,

  main: { flex: 1, position: 'relative', padding: '28px 24px 48px', width: '100%', maxWidth: 1040, margin: '0 auto' } as const,

  tabRow: { display: 'flex', gap: 4, padding: 4, background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 12, marginBottom: 20, boxShadow: '0 2px 10px -6px rgba(11,55,84,0.15)' } as const,
  tabBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, font: '600 14px Inter, sans-serif', padding: '10px 12px', border: 'none', background: 'transparent', color: palette.muted, borderRadius: 9, cursor: 'pointer' } as const,
  tabActive: { background: palette.navy, color: '#fff', boxShadow: '0 8px 16px -8px rgba(11,55,84,0.5)' } as const,
  tabCount: { fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.25)', padding: '1px 7px', borderRadius: 999 } as const,

  banner: {
    error: { display: 'flex', alignItems: 'center', gap: 8, background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 12, padding: '11px 16px', fontSize: 14, marginBottom: 16 } as const,
    ok: { display: 'flex', alignItems: 'center', gap: 8, background: palette.mint100, color: palette.tealDeep, border: `1px solid ${palette.teal}55`, borderRadius: 12, padding: '11px 16px', fontSize: 14, marginBottom: 16 } as const,
  },

  panel: { background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 18, boxShadow: '0 14px 32px -20px rgba(11,55,84,0.25)', marginBottom: 22, overflow: 'hidden' } as const,
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 22px', borderBottom: `1px solid ${palette.line}`, background: palette.mint50 } as const,
  panelHeadLeft: { display: 'flex', alignItems: 'center', gap: 10, font: '700 15.5px Poppins, sans-serif', color: palette.navy } as const,
  panelIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, background: palette.mint100, color: palette.teal } as const,
  panelSubtitle: { fontSize: 12.5, color: palette.muted, fontWeight: 500 } as const,
  panelBody: { padding: 22 } as const,

  muted: { color: palette.muted, fontSize: 14 } as const,
  hintMuted: { color: palette.muted, fontSize: 12.5, margin: '4px 0 10px' } as const,

  statRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 } as const,
  statCard: { display: 'flex', alignItems: 'center', gap: 10, background: palette.mint50, border: `1px solid ${palette.line}`, borderRadius: 14, padding: '12px 14px' } as const,
  statIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10 } as const,
  statValue: { fontFamily: 'Poppins, sans-serif', fontSize: 20, fontWeight: 700, lineHeight: 1.1 } as const,
  statLabel: { fontSize: 11.5, color: palette.muted, fontWeight: 600, marginTop: 1 } as const,

  tableWrap: { overflowX: 'auto' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14.5, minWidth: 480 } as const,
  th: { textAlign: 'left', font: '700 11.5px Inter, sans-serif', color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 12px 12px' } as const,
  td: { padding: '13px 12px', borderTop: `1px solid ${palette.line}`, color: palette.ink, verticalAlign: 'middle' } as const,

  nameCell: { display: 'flex', alignItems: 'center', gap: 12 } as const,
  avatar: { borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontFamily: 'Poppins, sans-serif', boxShadow: '0 6px 14px -6px rgba(11,55,84,0.5)' } as const,
  nameText: { fontWeight: 700, color: palette.navy, fontSize: 14.5 } as const,
  subText: { fontSize: 12.5, color: palette.muted, marginTop: 2 } as const,

  roleBadge: { display: 'inline-block', font: '700 11px Inter, sans-serif', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' } as const,

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '36px 16px', textAlign: 'center' } as const,
  emptyIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: palette.mint100, color: palette.teal } as const,

  searchRow: { display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' } as const,
  searchBox: { position: 'relative', flex: 1, minWidth: 240 } as const,
  searchIcon: { position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: palette.muted, display: 'flex' } as const,
  searchInput: { width: '100%', font: '14px Inter, sans-serif', padding: '10px 12px 10px 38px', border: `1.5px solid ${palette.line}`, borderRadius: 10, color: palette.ink, boxSizing: 'border-box', background: '#fff' } as const,
  viewToggle: { display: 'flex', gap: 2, padding: 3, background: palette.mint50, border: `1px solid ${palette.line}`, borderRadius: 10 } as const,
  viewToggleBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, border: 'none', background: 'transparent', color: palette.muted, borderRadius: 8, cursor: 'pointer' } as const,
  viewToggleBtnActive: { background: '#fff', color: palette.navy, boxShadow: '0 2px 6px -2px rgba(11,55,84,0.3)' } as const,
  chipRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 } as const,
  filterChip: { font: '700 12.5px Inter, sans-serif', padding: '7px 14px', borderRadius: 999, border: `1.5px solid ${palette.line}`, background: '#fff', color: palette.muted, cursor: 'pointer' } as const,
  showMoreBtn: { marginTop: 12, background: 'none', border: 'none', color: palette.teal, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', padding: 0 } as const,
  linkBtn: { background: 'none', border: 'none', font: '700 13px Inter, sans-serif', color: palette.teal, cursor: 'pointer', padding: '4px 8px' } as const,
  copyBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: 'none', background: palette.mint100, color: palette.tealDeep, borderRadius: 6, cursor: 'pointer', padding: 0 } as const,
  rowChevron: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: palette.muted, marginLeft: 6, cursor: 'pointer' } as const,
  markStyle: { background: '#fff3b0', padding: '0 1px', borderRadius: 2 } as const,

  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 } as const,
  accountCard: { background: '#fff', border: `1px solid ${palette.line}`, borderRadius: 16, padding: 16 } as const,
  accountCardTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } as const,
  cardArrow: { color: palette.teal, display: 'inline-flex' } as const,
  cardFooterRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${palette.line}` } as const,

  statusBadge: {
    active: { display: 'inline-flex', alignItems: 'center', gap: 6, font: '700 11.5px Inter, sans-serif', padding: '4px 10px 4px 8px', borderRadius: 999, background: palette.mint100, color: palette.tealDeep } as const,
    deactivated: { display: 'inline-flex', alignItems: 'center', gap: 6, font: '700 11.5px Inter, sans-serif', padding: '4px 10px 4px 8px', borderRadius: 999, background: '#fbe9e7', color: '#b3352b' } as const,
    locked: { font: '700 11px Inter, sans-serif', padding: '3px 9px', borderRadius: 999, background: '#fdf1e3', color: '#9a6412', display: 'inline-block', marginLeft: 6, cursor: 'help' } as const,
  },
  statusDot: {
    active: { width: 6, height: 6, borderRadius: '50%', background: palette.teal, display: 'inline-block' } as const,
    deactivated: { width: 6, height: 6, borderRadius: '50%', background: '#c0392b', display: 'inline-block' } as const,
  },

  topBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', color: palette.muted, border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' } as const,
  topbarRight: { display: 'flex', gap: 8 } as const,
  reviewBtn: { background: palette.navy, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' } as const,
  primaryBtn: { width: '100%', background: `linear-gradient(135deg, ${palette.teal}, ${palette.tealDeep})`, color: '#fff', fontSize: 15, fontWeight: 700, padding: '12px', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' } as const,
  primaryBtnDisabled: { opacity: 0.6, cursor: 'not-allowed' } as const,

  detailRow: { display: 'grid', gridTemplateColumns: '150px 1fr', padding: '11px 0', borderTop: `1px solid ${palette.line}` } as const,
  detailLabel: { font: '700 12.5px Inter, sans-serif', color: palette.muted } as const,
  detailValue: { fontSize: 14.5, color: palette.ink } as const,
  modalIdentity: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 } as const,

  actionRow: { display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' } as const,
  acceptBtn: { background: `linear-gradient(135deg, ${palette.teal}, ${palette.tealDeep})`, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' } as const,
  rejectBtn: { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' } as const,
  backBtn: { background: '#fff', color: palette.muted, border: `1.5px solid ${palette.line}`, borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' } as const,
  textarea: { width: '100%', font: '14px Inter, sans-serif', padding: '11px 13px', border: `1.5px solid ${palette.line}`, borderRadius: 10, marginTop: 6, resize: 'vertical', boxSizing: 'border-box' } as const,

  overlay: { position: 'fixed', inset: 0, background: 'rgba(11,55,84,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 } as const,
  modalBox: { background: '#fff', borderRadius: 16, boxShadow: '0 24px 60px -20px rgba(11,55,84,0.45)', width: 460, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto' } as const,
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${palette.line}`, font: '700 15.5px Poppins, sans-serif', color: palette.navy, background: palette.mint50 } as const,
  modalBody: { padding: 20 } as const,
  closeBtn: { background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: palette.muted, cursor: 'pointer', padding: 0 } as const,
  secondaryBtn: { background: '#fff', color: palette.navy, border: `1.5px solid ${palette.line}`, borderRadius: 9, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as const,
  dangerBtn: { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' } as const,
  radioRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: palette.navy, cursor: 'pointer', fontWeight: 600 } as const,
  presetGrid: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, marginLeft: 24 } as const,
  presetChip: { font: '13px Inter, sans-serif', padding: '7px 14px', borderRadius: 999, border: `1.5px solid ${palette.line}`, background: '#fff', color: palette.ink, cursor: 'pointer' } as const,
  presetChipActive: { background: palette.navy, color: '#fff', borderColor: palette.navy } as const,
  customRow: { display: 'flex', gap: 12, marginTop: 8, marginLeft: 24 } as const,
  numFieldLabel: { display: 'block', font: '700 11px Inter, sans-serif', color: palette.muted, marginBottom: 3, textTransform: 'uppercase' } as const,
  numFieldInput: { width: 64, font: '14px Inter, sans-serif', padding: '7px 9px', border: `1.5px solid ${palette.line}`, borderRadius: 8 } as const,

  skeletonRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${palette.line}` } as const,
  skeletonAvatar: { width: 36, height: 36, borderRadius: '50%', display: 'inline-block' } as const,
  skeletonLine: { display: 'inline-block', height: 10, borderRadius: 5 } as const,

  footer: { textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.muted, borderTop: `1px solid ${palette.line}`, position: 'relative' } as const,
  footerLink: { color: palette.navy, textDecoration: 'none', fontWeight: 600 } as const,
} satisfies Record<string, React.CSSProperties | Record<string, React.CSSProperties>>;
