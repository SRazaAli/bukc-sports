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
 */
import { useEffect, useState, useCallback, useRef, type FormEvent } from 'react';
import {
  listPending, verifyAccount, rejectAccount, inviteCoordinator, listCoordinatorInvites, deleteCoordinatorInvite,
  listActiveAccounts, searchAccounts, deactivateAccount, reactivateAccount, deleteAccountPermanently,
  type PendingAccount, type ManagedAccount, type CoordinatorInviteRecord,
} from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { PortalShell, LabeledInput, PrimaryButton, PersonIcon } from './PortalShell.js';
import { useAuth } from '../../lib/auth.js';

type Tab = 'pending' | 'active';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function AdminAccountsScreen() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
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
    <PortalShell title={isSuperAdmin ? 'Accounts' : 'Accounts (Read-only)'} tint="navy">
      {isSuperAdmin && (
        <div style={tabRow}>
          {(['pending', 'active'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t}
              onClick={() => { setTab(t); setError(null); setNotice(null); setSelected(null); }}
              style={{ ...tabBtn, ...(tab === t ? tabActive : null) }}>
              {t === 'pending' ? 'Pending Verification' : 'Active Accounts'}
            </button>
          ))}
        </div>
      )}

      {error && <div style={box.error}>{error}</div>}
      {notice && <div style={box.ok}>{notice}</div>}

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
            <Panel title="Pending Verification">
              {pending === null ? (
                <p style={muted}>Loading…</p>
              ) : pending.length === 0 ? (
                <p style={muted}>No accounts are awaiting verification. New registrations appear here.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Type</th><th style={th} /></tr>
                  </thead>
                  <tbody>
                    {pending.map((a) => (
                      <tr key={a.userId}>
                        <td style={td}>{a.fullName}</td>
                        <td style={td}>{a.email}</td>
                        <td style={td}><span style={badge}>{a.role}</span></td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button style={reviewBtn} onClick={() => setSelected(a)}>Review</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <InviteCoordinator onDone={setNotice} onError={setError} />
            <CoordinatorInviteLog onError={setError} />
          </>
        )
      ) : (
        <ActiveAccountsTab onError={setError} onNotice={setNotice} readOnly={!isSuperAdmin} />
      )}
    </PortalShell>
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

function ActiveAccountsTab({ onError, onNotice, readOnly }: { onError: (m: string) => void; onNotice: (m: string) => void; readOnly: boolean }) {
  const [accounts, setAccounts] = useState<ManagedAccount[] | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | ManagedAccount['role']>('');
  const [limit, setLimit] = useState(LIVE_LIMIT);
  const [loading, setLoading] = useState(false);
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

  return (
    <Panel title="Active Accounts">
      <div style={searchRow}>
        <input
          type="search" style={searchInput} value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setLimit(FULL_LIMIT); }}
          placeholder="Search by name, email, contact number, enrollment, institution…"
        />
        <select style={roleSelect} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as '' | ManagedAccount['role'])}>
          <option value="">All roles</option>
          <option value="STUDENT">Student</option>
          <option value="EXTERNAL">External</option>
          <option value="COORDINATOR">Coordinator</option>
        </select>
      </div>
      {searchTerm.trim().length > 0 && searchTerm.trim().length < MIN_SEARCH_CHARS && (
        <p style={hintMuted}>Type at least {MIN_SEARCH_CHARS} characters to search.</p>
      )}

      {accounts === null ? (
        <p style={muted}>Loading…</p>
      ) : accounts.length === 0 ? (
        <p style={muted}>{activeSearchTerm ? 'No matching accounts.' : 'No active or deactivated accounts yet.'}</p>
      ) : (
        <>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th><th style={th}>Role</th><th style={th}>Contact</th>
                <th style={th}>Status</th>{!readOnly && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.userId} style={rowClickable} onClick={() => setViewing(a)}>
                  <td style={td}>
                    <div style={nameLink}><Highlight text={a.fullName} term={activeSearchTerm} /></div>
                    <div style={subText}><Highlight text={a.email} term={activeSearchTerm} /></div>
                    {a.enrollmentNo && <div style={subText}>Enrollment: <Highlight text={a.enrollmentNo} term={activeSearchTerm} /></div>}
                    {a.institutionName && <div style={subText}><Highlight text={a.institutionName} term={activeSearchTerm} /></div>}
                  </td>
                  <td style={td}><span style={badge}>{a.role}</span></td>
                  <td style={td}><Highlight text={a.contactNumber} term={activeSearchTerm} /></td>
                  <td style={td}><StatusDisplay a={a} /></td>
                  {!readOnly && (
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      {a.status === 'ACTIVE' ? (
                        <button style={linkBtn} onClick={() => setDeactivating(a)}>Deactivate</button>
                      ) : (
                        <button style={linkBtn} onClick={() => handleReactivate(a)}>Reactivate</button>
                      )}
                      <button style={{ ...linkBtn, color: 'var(--danger, #c0392b)' }} onClick={() => setDeleting(a)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {activeSearchTerm && accounts.length >= limit && limit < FULL_LIMIT && (
            <button style={showMoreBtn} onClick={() => setLimit(FULL_LIMIT)}>Show all results</button>
          )}
          {loading && <p style={hintMuted}>Updating…</p>}
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

// Active/Deactivated status, plus a separate "Locked" badge (AUTH-11) when
// applicable — a locked account is still ACTIVE from the account-management
// point of view, this is purely "too many recent wrong password attempts,
// temporarily can't log in," so it's shown alongside the status rather than
// replacing it. Hover for the explanation and exact unlock time.
function StatusDisplay({ a }: { a: ManagedAccount }) {
  return (
    <>
      {a.status === 'ACTIVE' ? (
        <span style={statusBadge.active}>Active</span>
      ) : (
        <span style={statusBadge.deactivated}>
          Deactivated{a.deactivatedUntil ? ` until ${new Date(a.deactivatedUntil).toLocaleString()}` : ' (indefinite)'}
        </span>
      )}
      {a.lockedUntil && (
        <span
          style={statusBadge.locked}
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
  return <>{text.slice(0, idx)}<mark style={markStyle}>{text.slice(idx, idx + term.length)}</mark>{text.slice(idx + term.length)}</>;
}

// Full registration-time detail for one account — the same fields captured
// on the original registration form, already present on ManagedAccount from
// the list/search join, so this needs no extra fetch.
function AccountDetailModal({ account: a, onClose }: { account: ManagedAccount; onClose: () => void }) {
  const rows: Array<[string, string | undefined]> = a.role === 'STUDENT'
    ? [
        ['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber],
        ['Enrollment', a.enrollmentNo], ['Department', a.department], ['Program', a.programTitle],
      ]
    : a.role === 'EXTERNAL'
    ? [
        ['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber],
        ['Institution', a.institutionName], ['Designation', a.designation],
      ]
    : [
        ['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber],
      ];

  return (
    <Modal title={`Account Details — ${a.fullName}`} onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <span style={badge}>{a.role}</span> <StatusDisplay a={a} />
      </div>
      {rows.map(([label, value]) => (
        <div key={label} style={detailRow}>
          <div style={detailLabel}>{label}</div>
          <div style={detailValue}>{value ?? '—'}</div>
        </div>
      ))}
      <div style={detailRow}>
        <div style={detailLabel}>Account created</div>
        <div style={detailValue}>{new Date(a.createdAt).toLocaleString()}</div>
      </div>
      {a.deactivatedAt && (
        <div style={detailRow}>
          <div style={detailLabel}>Deactivated on</div>
          <div style={detailValue}>{new Date(a.deactivatedAt).toLocaleString()}</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" style={secondaryBtn} onClick={onClose}>Close</button>
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
          <label style={radioRow}>
            <input type="radio" checked={mode === 'preset'} onChange={() => setMode('preset')} />
            <span>For a preset duration</span>
          </label>
          {mode === 'preset' && (
            <div style={presetGrid}>
              {PRESETS.map((p) => (
                <button key={p.minutes} type="button"
                  style={{ ...presetChip, ...(presetMinutes === p.minutes ? presetChipActive : {}) }}
                  onClick={() => setPresetMinutes(p.minutes)}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={radioRow}>
            <input type="radio" checked={mode === 'custom'} onChange={() => setMode('custom')} />
            <span>Custom duration</span>
          </label>
          {mode === 'custom' && (
            <div style={customRow}>
              <NumField label="Days" value={days} onChange={setDays} />
              <NumField label="Hours" value={hours} onChange={setHours} max={23} />
              <NumField label="Minutes" value={minutes} onChange={setMinutes} max={59} />
            </div>
          )}
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={radioRow}>
            <input type="radio" checked={mode === 'indefinite'} onChange={() => setMode('indefinite')} />
            <span>Until I reactivate it</span>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" style={secondaryBtn} onClick={onCancel}>Cancel</button>
          <button type="submit" style={dangerBtn} disabled={mode === 'custom' && customMinutes <= 0}>Deactivate</button>
        </div>
      </form>
    </Modal>
  );
}

function NumField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <div>
      <span style={numFieldLabel}>{label}</span>
      <input type="number" min={0} max={max} style={numFieldInput} value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max ?? 9999, Number(e.target.value) || 0)))} />
    </div>
  );
}

// ── Shared small modal primitives ──
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalBox} onMouseDown={(e) => e.stopPropagation()}>
        <div style={modalHead}><span>{title}</span><button type="button" onClick={onClose} style={closeBtn} aria-label="Close">×</button></div>
        <div style={modalBody}>{children}</div>
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
      <p style={{ margin: '0 0 16px', fontSize: 14, color: '#3a4552', lineHeight: 1.5 }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={onCancel} style={secondaryBtn}>Cancel</button>
        <button type="button" onClick={onConfirm} style={danger ? dangerBtn : reviewBtn}>{confirmLabel}</button>
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
    <Panel title={`Review ${a.role === 'STUDENT' ? 'Student' : 'External'} Application`}>
      <div style={{ marginBottom: 20 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={detailRow}>
            <div style={detailLabel}>{label}</div>
            <div style={detailValue}>{value ?? '—'}</div>
          </div>
        ))}
      </div>

      {!rejecting ? (
        <div style={actionRow}>
          <button style={acceptBtn} onClick={onAccept}>Accept &amp; Activate</button>
          <button style={rejectBtn} onClick={() => setRejecting(true)}>Reject…</button>
          <button style={backBtn} onClick={onBack}>Back to queue</button>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <label style={detailLabel}>Reason for rejection (emailed to the applicant)</label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="e.g. Enrollment number does not match our records."
            style={textarea}
          />
          <div style={actionRow}>
            <button
              style={{ ...rejectBtn, opacity: reason.trim() ? 1 : 0.5 }}
              disabled={!reason.trim()}
              onClick={() => onReject(reason.trim())}
            >
              Confirm rejection
            </button>
            <button style={backBtn} onClick={() => { setRejecting(false); setReason(''); }}>Cancel</button>
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
    <Panel title="Invite a Coordinator">
      <p style={{ ...muted, marginTop: 0 }}>
        The coordinator receives an email link to set their own password. You never handle their password.
      </p>
      <form onSubmit={onSubmit} noValidate style={{ maxWidth: 420 }}>
        <LabeledInput label="Full name:" icon={<PersonIcon />} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <LabeledInput label="Email:" icon={<PersonIcon />} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <LabeledInput label="Contact number:" icon={<PersonIcon />} value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} required />
        <PrimaryButton type="submit" disabled={loading}>{loading ? 'Sending…' : 'Send Invitation'}</PrimaryButton>
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
    <Panel title="Coordinator Invitations Sent">
      {invites !== null && invites.length > 0 && (
        <div style={searchRow}>
          <input style={searchInput} placeholder="Search by name or email…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
      )}
      {activeSearchTerm && filtered?.length === 0 && <p style={hintMuted}>No invitations match "{activeSearchTerm}".</p>}
      {filtered === null ? (
        <p style={muted}>Loading…</p>
      ) : filtered.length === 0 && !activeSearchTerm ? (
        <p style={muted}>No coordinator invitations have been sent yet.</p>
      ) : filtered.length > 0 ? (
        <table style={table}>
          <thead>
            <tr><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Invited By</th><th style={th}>Sent</th><th style={th}>Status</th><th style={th} /></tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.inviteId}>
                <td style={td}><Highlight text={i.fullName} term={activeSearchTerm} /></td>
                <td style={td}><Highlight text={i.email} term={activeSearchTerm} /></td>
                <td style={td}><Highlight text={i.invitedByName} term={activeSearchTerm} /></td>
                <td style={td}>{new Date(i.issuedAt).toLocaleString()}</td>
                <td style={td}><span style={{ ...badge, ...inviteStatusStyle(i.status) }}>{i.status}</span></td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button style={{ ...linkBtn, color: 'var(--danger, #c0392b)' }} onClick={() => setDeleting(i)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  if (status === 'ACCEPTED') return { background: '#e6f4ec', color: '#1f7a45' };
  if (status === 'EXPIRED') return { background: '#fbe9e7', color: '#b3352b' };
  return { background: '#fdf1e3', color: '#9a6412' };
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={panel}>
      <div style={panelHead}>{title}</div>
      <div style={panelBody}>{children}</div>
    </section>
  );
}

const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14 };
const hintMuted: React.CSSProperties = { color: '#8a949f', fontSize: 12.5, margin: '4px 0 10px' };
const panel: React.CSSProperties = { maxWidth: 900, margin: '0 auto 20px', background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { padding: '14px 20px', borderBottom: '1px solid #e5e5e5', font: '600 16px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 20 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14.5 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 12px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 10px 10px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '12px 10px', borderBottom: '1px solid #eee', color: '#333', verticalAlign: 'top' };
const subText: React.CSSProperties = { fontSize: 12.5, color: '#8a949f', marginTop: 2 };
const rowClickable: React.CSSProperties = { cursor: 'pointer' };
const nameLink: React.CSSProperties = { color: '#0a6ebd', fontWeight: 500 };
const badge: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '3px 8px', borderRadius: 4, background: '#eef2f6', color: '#2f4a5c' };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 14, cursor: 'pointer' };
const detailRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', padding: '10px 0', borderBottom: '1px solid #f0f0f0' };
const detailLabel: React.CSSProperties = { font: '600 13px var(--font-body)', color: '#555' };
const detailValue: React.CSSProperties = { fontSize: 14.5, color: '#222' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 20px', fontSize: 14.5, cursor: 'pointer' };
const rejectBtn: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 20px', fontSize: 14.5, cursor: 'pointer' };
const backBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '10px 20px', fontSize: 14.5, cursor: 'pointer' };
const textarea: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '10px 12px', border: '1px solid #ccc', borderRadius: 4, marginTop: 6, resize: 'vertical' };
const box = {
  error: { maxWidth: 900, margin: '0 auto 16px', background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
  ok: { maxWidth: 900, margin: '0 auto 16px', background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
  info: { marginTop: 14, background: '#fdf1e8', color: '#8a4413', border: '1px solid #f3d3ba', borderRadius: 4, padding: '10px 14px', fontSize: 13.5 } as React.CSSProperties,
};

const tabRow: React.CSSProperties = { maxWidth: 900, margin: '0 auto 18px', display: 'flex', gap: 4, padding: 4, background: '#e7edf4', borderRadius: 10 };
const tabBtn: React.CSSProperties = { flex: 1, font: '500 14px var(--font-body)', padding: '9px 10px', border: 'none', background: 'transparent', color: '#5c6773', borderRadius: 7, cursor: 'pointer' };
const tabActive: React.CSSProperties = { background: '#fff', color: '#26485f', boxShadow: '0 1px 2px rgba(15,27,45,0.1)' };

const searchRow: React.CSSProperties = { display: 'flex', gap: 10, marginBottom: 6, flexWrap: 'wrap' };
const searchInput: React.CSSProperties = { flex: 1, minWidth: 260, font: '14px var(--font-body)', padding: '9px 12px', border: '1px solid #ccc', borderRadius: 4 };
const roleSelect: React.CSSProperties = { font: '14px var(--font-body)', padding: '9px 12px', border: '1px solid #ccc', borderRadius: 4, background: '#fff' };
const showMoreBtn: React.CSSProperties = { marginTop: 10, background: 'none', border: 'none', color: '#0a6ebd', fontSize: 13.5, cursor: 'pointer', padding: 0 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', font: '500 13px var(--font-body)', color: '#0a6ebd', cursor: 'pointer', padding: '4px 8px' };
const markStyle: React.CSSProperties = { background: '#fff3b0', padding: '0 1px', borderRadius: 2 };
const statusBadge = {
  active: { font: '600 11px var(--font-mono)', padding: '3px 8px', borderRadius: 4, background: '#e6f4ec', color: '#1f7a45' } as React.CSSProperties,
  deactivated: { font: '600 11px var(--font-mono)', padding: '3px 8px', borderRadius: 4, background: '#fbe9e7', color: '#b3352b', display: 'inline-block' } as React.CSSProperties,
  locked: { font: '600 11px var(--font-mono)', padding: '3px 8px', borderRadius: 4, background: '#fdf1e3', color: '#9a6412', display: 'inline-block', marginLeft: 6, cursor: 'help' } as React.CSSProperties,
};

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(15,27,45,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalBox: React.CSSProperties = { background: '#fff', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,0.2)', width: 440, maxWidth: '92vw', maxHeight: '88vh', overflowY: 'auto' };
const modalHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#26485f' };
const modalBody: React.CSSProperties = { padding: 18 };
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: '#8a949f', cursor: 'pointer', padding: 0 };
const secondaryBtn: React.CSSProperties = { background: '#fff', color: '#26485f', border: '1px solid #ccc', borderRadius: 4, padding: '8px 16px', fontSize: 14, cursor: 'pointer' };
const dangerBtn: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px', fontSize: 14, cursor: 'pointer' };
const radioRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#26485f', cursor: 'pointer' };
const presetGrid: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, marginLeft: 24 };
const presetChip: React.CSSProperties = { font: '13px var(--font-body)', padding: '6px 12px', borderRadius: 16, border: '1px solid #ccc', background: '#fff', color: '#333', cursor: 'pointer' };
const presetChipActive: React.CSSProperties = { background: '#0a6ebd', color: '#fff', borderColor: '#0a6ebd' };
const customRow: React.CSSProperties = { display: 'flex', gap: 12, marginTop: 8, marginLeft: 24 };
const numFieldLabel: React.CSSProperties = { display: 'block', font: '500 11px var(--font-body)', color: '#8a949f', marginBottom: 3, textTransform: 'uppercase' };
const numFieldInput: React.CSSProperties = { width: 64, font: '14px var(--font-body)', padding: '6px 8px', border: '1px solid #ccc', borderRadius: 4 };
