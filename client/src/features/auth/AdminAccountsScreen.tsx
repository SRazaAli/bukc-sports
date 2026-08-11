/**
 * Super Admin — Account Management.
 *
 * Tab 1: Pending Verification — uses GET /api/auth/admin/pending (exists)
 * Tab 2: All Accounts — the backend has no /admin/users endpoint yet.
 *         We build this using POST /api/auth/admin/deactivate (exists).
 *         Until the endpoint is added, we show a clear message explaining
 *         what endpoint is needed with the exact Kysely query to add.
 * Tab 3: Invite Coordinator — uses POST /api/auth/admin/invite-coordinator (exists)
 *
 * Backend unchanged: all calls use only existing router endpoints.
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import {
  listPending, verifyAccount, rejectAccount, deactivateAccount, inviteCoordinator,
  type PendingAccount,
} from './api.js';
import { ApiRequestError, api } from '../../lib/api.js';
import AppShell, {
  PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper,
} from '../../components/AppShell.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

type Tab = 'pending' | 'accounts' | 'invite';

interface ActiveAccount {
  userId: string;
  role: string;
  fullName: string;
  email: string;
  contactNumber: string;
  status: string;
  createdAt: string;
}

// Attempts GET /api/auth/admin/users — gracefully handles 404 if not yet added.
async function tryListAllAccounts(): Promise<{ accounts: ActiveAccount[]; missing: boolean }> {
  try {
    const res = await api<{ accounts: ActiveAccount[] }>('/api/auth/admin/users');
    return { accounts: res.accounts, missing: false };
  } catch (e) {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 405)) {
      return { accounts: [], missing: true };
    }
    throw e;
  }
}

export default function AdminAccountsScreen() {
  const [tab,      setTab]      = useState<Tab>('pending');
  const [pending,  setPending]  = useState<PendingAccount[] | null>(null);
  const [accounts, setAccounts] = useState<ActiveAccount[] | null>(null);
  const [acctMissing, setAcctMissing] = useState(false);
  const [selected, setSelected] = useState<PendingAccount | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    try { setPending((await listPending()).accounts); }
    catch (e) { setError(errMsg(e)); }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const { accounts: accts, missing } = await tryListAllAccounts();
      setAccounts(accts);
      setAcctMissing(missing);
    } catch (e) {
      setError(errMsg(e));
      setAccounts([]);
    }
  }, []);

  useEffect(() => { void loadPending(); }, [loadPending]);
  useEffect(() => {
    if (tab === 'accounts' && accounts === null) void loadAll();
  }, [tab, accounts, loadAll]);

  async function onAccept(a: PendingAccount) {
    setError(null); setNotice(null);
    try {
      await verifyAccount(a.userId);
      setNotice(`${a.fullName}'s account has been activated.`);
      setSelected(null);
      await loadPending();
    } catch (e) { setError(errMsg(e)); }
  }

  async function onReject(a: PendingAccount, reason: string) {
    setError(null); setNotice(null);
    try {
      await rejectAccount(a.userId, reason);
      setNotice(`${a.fullName}'s application was rejected.`);
      setSelected(null);
      await loadPending();
    } catch (e) { setError(errMsg(e)); }
  }

  async function onDeactivate(userId: string, name: string) {
    if (!window.confirm(`Deactivate ${name}? They will immediately lose platform access.`)) return;
    setError(null); setNotice(null);
    try {
      await deactivateAccount(userId);
      setNotice(`${name} has been deactivated.`);
      void loadAll();
    } catch (e) { setError(errMsg(e)); }
  }

  return (
    <AppShell title="Account Management">
      <PageHeader title="Account Management" subtitle="Verify registrations, manage users, invite coordinators" />
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--sp-4)', borderBottom: '2px solid var(--line-light)', paddingBottom: 0 }}>
        {([
          ['pending', 'Pending Verification', pending?.length],
          ['accounts', 'All Accounts', null],
          ['invite',  'Invite Coordinator', null],
        ] as const).map(([id, label, count]) => (
          <button key={id} onClick={() => { setTab(id); setSelected(null); setError(null); }} style={{
            padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
            font: `${tab === id ? '600' : '400'} 13.5px var(--font-body)`,
            color: tab === id ? 'var(--teal)' : 'var(--ink-muted)',
            borderBottom: `2px solid ${tab === id ? 'var(--teal)' : 'transparent'}`,
            marginBottom: -2,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {label}
            {count !== null && count !== undefined && count > 0 && (
              <span style={{
                background: tab === id ? 'var(--teal)' : 'var(--line)',
                color: tab === id ? '#fff' : 'var(--ink-muted)',
                font: '600 10px var(--font-mono)', padding: '1px 6px', borderRadius: 10,
              }}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Pending ── */}
      {tab === 'pending' && (
        selected ? (
          <ReviewPanel
            account={selected}
            onBack={() => setSelected(null)}
            onAccept={() => onAccept(selected)}
            onReject={(r) => onReject(selected, r)}
          />
        ) : (
          <Card style={{ padding: 'var(--sp-5)' }}>
            {pending === null
              ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
              : pending.length === 0
              ? <EmptyState title="All clear" body="No accounts awaiting verification. New student and external registrations appear here." />
              : (
                <TableWrapper>
                  <thead>
                    <tr>
                      <th style={Th}>Name</th>
                      <th style={Th}>Email</th>
                      <th style={Th}>Role</th>
                      <th style={Th}>Joined</th>
                      <th style={Th} />
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((a) => (
                      <tr key={a.userId}>
                        <td style={Td}>{a.fullName}</td>
                        <td style={{ ...Td, fontSize: 13 }}>{a.email}</td>
                        <td style={Td}><Badge status={a.role} /></td>
                        <td style={{ ...Td, fontSize: 13 }}>
                          {new Date(a.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ ...Td, textAlign: 'right' }}>
                          <Btn size="sm" onClick={() => setSelected(a)}>Review</Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              )
            }
          </Card>
        )
      )}

      {/* ── Tab: All Accounts ── */}
      {tab === 'accounts' && (
        accounts === null ? (
          <Card style={{ padding: 'var(--sp-5)' }}>
            <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
          </Card>
        ) : acctMissing ? (
          /* Endpoint not yet added to the server */
          <Card style={{ padding: 'var(--sp-5)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 'var(--sp-4)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--warn-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="var(--warn)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 1L1 15h16L9 1z"/><line x1="9" y1="7" x2="9" y2="11"/>
                  <circle cx="9" cy="13.5" r=".5" fill="var(--warn)" stroke="none"/>
                </svg>
              </div>
              <div>
                <div style={{ font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>
                  Backend endpoint not yet added
                </div>
                <p style={{ font: '13.5px/1.6 var(--font-body)', color: 'var(--ink-muted)', margin: 0 }}>
                  The All Accounts tab needs <code style={{ font: '12.5px var(--font-mono)', background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>GET /api/auth/admin/users</code> on the server. Add the following to <code style={{ font: '12.5px var(--font-mono)', background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>server/src/features/auth/router.ts</code> and <code style={{ font: '12.5px var(--font-mono)', background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>service.ts</code>:
                </p>
              </div>
            </div>

            {/* Code snippets for the developer */}
            <div style={{ background: 'var(--navy)', borderRadius: 'var(--radius)', padding: 'var(--sp-4)', marginBottom: 'var(--sp-3)', overflowX: 'auto' }}>
              <div style={{ font: '11px var(--font-mono)', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>// router.ts — add after /admin/pending</div>
              <pre style={{ font: '12.5px/1.7 var(--font-mono)', color: '#a8d8b9', margin: 0 }}>{`authRouter.get('/admin/users', requireAuth, requireRole('SUPER_ADMIN'),
  asyncHandler(async (_req, res) => {
    res.json({ accounts: await svc.listAllAccounts() });
  }));`}</pre>
            </div>

            <div style={{ background: 'var(--navy)', borderRadius: 'var(--radius)', padding: 'var(--sp-4)', overflowX: 'auto' }}>
              <div style={{ font: '11px var(--font-mono)', color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>// service.ts — add after listPendingAccounts()</div>
              <pre style={{ font: '12.5px/1.7 var(--font-mono)', color: '#a8d8b9', margin: 0 }}>{`export async function listAllAccounts() {
  const rows = await db.selectFrom('app_user')
    .select([
      'user_id', 'role', 'full_name', 'email',
      'contact_number', 'status', 'created_at',
    ])
    .where('status', 'in', ['ACTIVE', 'DEACTIVATED'])
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map((r) => ({
    userId: r.user_id, role: r.role,
    fullName: r.full_name, email: r.email,
    contactNumber: r.contact_number,
    status: r.status,
    createdAt: new Date(r.created_at as unknown as string).toISOString(),
  }));
}`}</pre>
            </div>

            <p style={{ font: '12.5px var(--font-body)', color: 'var(--ink-faint)', margin: 'var(--sp-3) 0 0' }}>
              Once the endpoint exists, this tab will automatically show all active and deactivated accounts with a Deactivate button for each.
            </p>
          </Card>
        ) : accounts.length === 0 ? (
          <Card style={{ padding: 'var(--sp-5)' }}>
            <EmptyState title="No accounts found" body="No active or deactivated accounts returned." />
          </Card>
        ) : (
          <Card style={{ padding: 'var(--sp-5)' }}>
            <TableWrapper>
              <thead>
                <tr>
                  <th style={Th}>Name</th>
                  <th style={Th}>Email</th>
                  <th style={Th}>Role</th>
                  <th style={Th}>Status</th>
                  <th style={Th}>Joined</th>
                  <th style={Th} />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.userId}>
                    <td style={Td}>{a.fullName}</td>
                    <td style={{ ...Td, fontSize: 13 }}>{a.email}</td>
                    <td style={Td}><Badge status={a.role} /></td>
                    <td style={Td}>
                      <Badge status={
                        a.status === 'ACTIVE' ? 'APPROVED' :
                        a.status === 'DEACTIVATED' ? 'CANCELLED' : 'PENDING'
                      } />
                    </td>
                    <td style={{ ...Td, fontSize: 13 }}>
                      {new Date(a.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ ...Td, textAlign: 'right' }}>
                      {a.status === 'ACTIVE' && a.role !== 'SUPER_ADMIN' && (
                        <Btn size="sm" variant="danger" onClick={() => onDeactivate(a.userId, a.fullName)}>
                          Deactivate
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          </Card>
        )
      )}

      {/* ── Tab: Invite ── */}
      {tab === 'invite' && (
        <InviteCoordinator
          onDone={(m) => { setNotice(m); setError(null); }}
          onError={(m) => { setError(m); setNotice(null); }}
        />
      )}
    </AppShell>
  );
}

// ── Review panel ──────────────────────────────────────────────────────────────

function ReviewPanel({
  account, onBack, onAccept, onReject,
}: {
  account: PendingAccount; onBack: () => void;
  onAccept: () => void; onReject: (reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const a = account;

  const rows: Array<[string, string | undefined]> = a.role === 'STUDENT'
    ? [
        ['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber],
        ['Enrollment No.', a.enrollmentNo], ['Department', a.department], ['Program', a.programTitle],
      ]
    : [
        ['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber],
        ['Institution', a.institutionName], ['Representative', a.representativeName], ['Designation', a.designation],
      ];

  return (
    <Card style={{ padding: 'var(--sp-5)', maxWidth: 600 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', font: '13px var(--font-body)', padding: 0, marginBottom: 'var(--sp-4)' }}>
        ← Back to queue
      </button>
      <div style={{ font: '600 16px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-4)' }}>
        Review {a.role === 'STUDENT' ? 'Student' : 'External'} Application
      </div>

      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', padding: '10px 0', borderBottom: '1px solid var(--line-light)' }}>
          <span style={{ font: '500 13px var(--font-body)', color: 'var(--ink-muted)' }}>{label}</span>
          <span style={{ font: '14px var(--font-body)', color: 'var(--ink)' }}>{value ?? '—'}</span>
        </div>
      ))}

      <div style={{ marginTop: 'var(--sp-4)' }}>
        {!rejecting ? (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <Btn onClick={onAccept}>Accept &amp; Activate</Btn>
            <Btn variant="danger" onClick={() => setRejecting(true)}>Reject…</Btn>
            <Btn variant="secondary" onClick={onBack}>Back</Btn>
          </div>
        ) : (
          <>
            <label style={lbl}>Reason for rejection (emailed to the applicant)</label>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="e.g. Enrollment number does not match our records."
              style={{ width: '100%', font: '14px var(--font-body)', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', resize: 'vertical', outline: 'none', marginBottom: 'var(--sp-3)' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn variant="danger" disabled={!reason.trim()} onClick={() => onReject(reason.trim())}>
                Confirm Rejection
              </Btn>
              <Btn variant="secondary" onClick={() => { setRejecting(false); setReason(''); }}>Cancel</Btn>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// ── Invite Coordinator ────────────────────────────────────────────────────────

function InviteCoordinator({
  onDone, onError,
}: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [fullName,      setFullName]      = useState('');
  const [email,         setEmail]         = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [loading,       setLoading]       = useState(false);
  const [devLink,       setDevLink]       = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setLoading(true); setDevLink(null);
    try {
      const res = await inviteCoordinator({ fullName, email, contactNumber });
      onDone(`Invitation sent to ${email}.`);
      if (res.devToken) {
        setDevLink(`${window.location.origin}/accept-invite?token=${res.devToken}`);
      }
      setFullName(''); setEmail(''); setContactNumber('');
    } catch (e) { onError(errMsg(e)); }
    finally { setLoading(false); }
  }

  return (
    <Card style={{ padding: 'var(--sp-5)', maxWidth: 600 }}>
      <div style={{ font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>
        Invite a Coordinator
      </div>
      <p style={{ font: '13.5px var(--font-body)', color: 'var(--ink-muted)', margin: '0 0 var(--sp-4)' }}>
        The coordinator receives an email link to set their own password. You never handle their credentials.
      </p>
      <form onSubmit={onSubmit} noValidate
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 'var(--sp-3)' }}>
        <div>
          <label style={lbl}>Full Name</label>
          <input style={inp} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Muhammad Ali" required />
        </div>
        <div>
          <label style={lbl}>Email</label>
          <input style={inp} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="coord@bukc.edu.pk" required />
        </div>
        <div>
          <label style={lbl}>Contact Number</label>
          <input style={inp} value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="03xxxxxxxxx" required />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Btn type="submit" loading={loading} style={{ width: '100%' }}>Send Invitation</Btn>
        </div>
      </form>

      {devLink && (
        <div style={{ marginTop: 'var(--sp-4)', background: 'var(--surface-alt)', border: '1px solid var(--navy-100)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)' }}>
          <div style={{ font: '600 11px var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 4 }}>
            Dev invite link (email is in console mode)
          </div>
          <a href={devLink} style={{ font: '12px var(--font-mono)', color: 'var(--teal)', wordBreak: 'break-all' }}>
            {devLink}
          </a>
        </div>
      )}
    </Card>
  );
}

const lbl: React.CSSProperties = { display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '13.5px var(--font-body)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none', background: 'var(--white)', color: 'var(--ink)' };
