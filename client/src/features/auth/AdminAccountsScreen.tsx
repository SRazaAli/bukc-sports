/**
 * Super Admin — Account Management.
 * Same backend logic: listPending, verifyAccount, rejectAccount, inviteCoordinator.
 * Redesigned with AppShell theme.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { listPending, verifyAccount, rejectAccount, inviteCoordinator, type PendingAccount } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import AppShell, { PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper } from '../../components/AppShell.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function AdminAccountsScreen() {
  const [pending,  setPending]  = useState<PendingAccount[] | null>(null);
  const [selected, setSelected] = useState<PendingAccount | null>(null);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try { const res = await listPending(); setPending(res.accounts); }
    catch (e) { setError(errMsg(e)); }
  }
  useEffect(() => { void refresh(); }, []);

  async function onAccept(a: PendingAccount) {
    setError(null); setNotice(null);
    try { await verifyAccount(a.userId); setNotice(`${a.fullName}'s account has been activated.`); setSelected(null); await refresh(); }
    catch (e) { setError(errMsg(e)); }
  }
  async function onReject(a: PendingAccount, reason: string) {
    setError(null); setNotice(null);
    try { await rejectAccount(a.userId, reason); setNotice(`${a.fullName}'s application was rejected.`); setSelected(null); await refresh(); }
    catch (e) { setError(errMsg(e)); }
  }

  return (
    <AppShell title="Account Management">
      <PageHeader title="Account Management" subtitle="Verify new registrations and invite coordinators" />
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {selected ? (
        <ReviewPanel account={selected} onBack={() => setSelected(null)}
          onAccept={() => onAccept(selected)} onReject={(r) => onReject(selected, r)} />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <Card style={{ padding: 'var(--sp-5)' }}>
            <div style={{ font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-4)' }}>
              Pending Verification
              {pending && pending.length > 0 && (
                <span style={{ marginLeft: 8, background: 'var(--teal)', color: '#fff', font: '600 10px var(--font-mono)', padding: '2px 7px', borderRadius: 10 }}>{pending.length}</span>
              )}
            </div>
            {pending === null ? (
              <p style={{ color: 'var(--ink-muted)', fontSize: 14 }}>Loading…</p>
            ) : pending.length === 0 ? (
              <EmptyState title="All clear" body="No accounts are awaiting verification." />
            ) : (
              <TableWrapper>
                <thead><tr><th style={Th}>Name</th><th style={Th}>Email</th><th style={Th}>Type</th><th style={Th}>Joined</th><th style={Th} /></tr></thead>
                <tbody>{pending.map((a) => (
                  <tr key={a.userId}>
                    <td style={Td}>{a.fullName}</td>
                    <td style={Td} style2={undefined}>{a.email}</td>
                    <td style={Td}><Badge status={a.role} /></td>
                    <td style={Td}>{new Date(a.createdAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                    <td style={{ ...Td, textAlign: 'right' }}>
                      <Btn size="sm" onClick={() => setSelected(a)}>Review</Btn>
                    </td>
                  </tr>
                ))}</tbody>
              </TableWrapper>
            )}
          </Card>

          <InviteCoordinator onDone={setNotice} onError={setError} />
        </div>
      )}
    </AppShell>
  );
}

function ReviewPanel({ account, onBack, onAccept, onReject }: {
  account: PendingAccount; onBack: () => void; onAccept: () => void; onReject: (reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const a = account;

  const rows: Array<[string, string | undefined]> = a.role === 'STUDENT'
    ? [['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber], ['Enrollment', a.enrollmentNo], ['Department', a.department], ['Program', a.programTitle]]
    : [['Full Name', a.fullName], ['Email', a.email], ['Contact', a.contactNumber], ['Institution', a.institutionName], ['Representative', a.representativeName], ['Designation', a.designation]];

  return (
    <Card style={{ padding: 'var(--sp-5)', maxWidth: 640 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', font: '13px var(--font-body)', padding: 0, marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 4 }}>
        ← Back to queue
      </button>
      <div style={{ font: '600 16px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-4)' }}>
        Review {a.role === 'STUDENT' ? 'Student' : 'External'} Application
      </div>

      <div style={{ marginBottom: 'var(--sp-4)' }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', padding: '10px 0', borderBottom: '1px solid var(--line-light)' }}>
            <span style={{ font: '500 13px var(--font-body)', color: 'var(--ink-muted)' }}>{label}</span>
            <span style={{ font: '14px var(--font-body)', color: 'var(--ink)' }}>{value ?? '—'}</span>
          </div>
        ))}
      </div>

      {!rejecting ? (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <Btn onClick={onAccept}>Accept &amp; Activate</Btn>
          <Btn variant="danger" onClick={() => setRejecting(true)}>Reject…</Btn>
          <Btn variant="secondary" onClick={onBack}>Back</Btn>
        </div>
      ) : (
        <div>
          <label style={{ display: 'block', font: '500 13px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 6 }}>
            Reason for rejection (emailed to the applicant)
          </label>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder="e.g. Enrollment number does not match our records."
            style={{ width: '100%', font: '14px var(--font-body)', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', resize: 'vertical', outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <Btn variant="danger" disabled={!reason.trim()} onClick={() => onReject(reason.trim())}>Confirm Rejection</Btn>
            <Btn variant="secondary" onClick={() => { setRejecting(false); setReason(''); }}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function InviteCoordinator({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [fullName, setFullName]           = useState('');
  const [email, setEmail]                 = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [loading, setLoading]             = useState(false);
  const [devLink, setDevLink]             = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setLoading(true); setDevLink(null);
    try {
      const res = await inviteCoordinator({ fullName, email, contactNumber });
      onDone(`Invitation sent to ${email}.`);
      if (res.devToken) setDevLink(`${window.location.origin}/accept-invite?token=${res.devToken}`);
      setFullName(''); setEmail(''); setContactNumber('');
    } catch (e) { onError(errMsg(e)); }
    finally { setLoading(false); }
  }

  return (
    <Card style={{ padding: 'var(--sp-5)', maxWidth: 640 }}>
      <div style={{ font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>Invite a Coordinator</div>
      <p style={{ font: '13.5px var(--font-body)', color: 'var(--ink-muted)', margin: '0 0 var(--sp-4)' }}>
        The coordinator receives an email link to set their own password.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
          {[['Full Name', fullName, setFullName, 'text', 'Muhammad Ali'], ['Email', email, setEmail, 'email', 'coordinator@bukc.edu.pk'], ['Contact', contactNumber, setContactNumber, 'tel', '03xxxxxxxxx']].map(([label, val, setter, type, ph]) => (
            <div key={label as string}>
              <label style={{ display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 5 }}>{label as string}</label>
              <input
                type={type as string} value={val as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                placeholder={ph as string} required
                style={{ width: '100%', font: '14px var(--font-body)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none' }}
              />
            </div>
          ))}
        </div>
        <Btn type="submit" loading={loading}>Send Invitation</Btn>
      </form>
      {devLink && (
        <div style={{ marginTop: 'var(--sp-4)', background: 'var(--surface-alt)', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)' }}>
          <div style={{ font: '600 12px var(--font-mono)', color: 'var(--ink-muted)', marginBottom: 4 }}>Dev invite link (email is console-mode):</div>
          <a href={devLink} style={{ font: '12px var(--font-mono)', color: 'var(--teal)', wordBreak: 'break-all' }}>{devLink}</a>
        </div>
      )}
    </Card>
  );
}
