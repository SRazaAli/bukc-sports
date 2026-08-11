/**
 * Coordinator — Borrow Queue (BORROW-07..14). Redesigned with AppShell.
 * Backend unchanged: listQueue, approveRequest, rejectRequest, lendPlatform, lendWalkinGuest.
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { listTypes, listArticles, type EquipmentType, type Article } from '../inventory/api.js';
import { listQueue, approveRequest, rejectRequest, lendPlatform, lendWalkinGuest, type QueueItem } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
function fmtDT(d: string) { return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }

export default function BorrowQueueScreen() {
  const { user, loading } = useAuth();
  const [queue,     setQueue]     = useState<QueueItem[] | null>(null);
  const [selected,  setSelected]  = useState<QueueItem | null>(null);
  const [showWalkin,setShowWalkin]= useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [notice,    setNotice]    = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setQueue((await listQueue()).queue); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="Borrow Queue"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash = { ok: (m: string) => { setNotice(m); setError(null); setSelected(null); setShowWalkin(false); void load(); }, err: (m: string) => { setError(m); setNotice(null); } };

  return (
    <AppShell title="Borrow Queue">
      <PageHeader title="Borrow Queue" subtitle="Review equipment requests and handle walk-in lending">
        <Btn variant="secondary" onClick={() => setShowWalkin((v) => !v)}>{showWalkin ? 'Close' : 'Walk-in Lending'}</Btn>
      </PageHeader>
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {showWalkin && (
        <Card style={{ padding: 'var(--sp-5)', marginBottom: 'var(--sp-4)' }}>
          <div style={secTitle}>Walk-in Guest Lending</div>
          <WalkinForm onDone={flash.ok} onError={flash.err} />
        </Card>
      )}

      {selected ? (
        <LendPanel item={selected} onBack={() => setSelected(null)} onDone={flash.ok} onError={flash.err} />
      ) : (
        <Card style={{ padding: 'var(--sp-5)' }}>
          <div style={{ ...secTitle, marginBottom: 'var(--sp-4)' }}>
            Pending Requests
            {queue && queue.length > 0 && <span style={{ marginLeft: 8, background: 'var(--teal)', color: '#fff', font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 10 }}>{queue.length}</span>}
          </div>
          {queue === null ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
          : queue.length === 0 ? <EmptyState title="No pending requests" body="Student requests appear here for review." />
          : (
            <TableWrapper>
              <thead><tr><th style={Th}>Student</th><th style={Th}>Equipment</th><th style={Th}>Requested window</th><th style={Th}>Submitted</th><th style={Th} /></tr></thead>
              <tbody>{queue.map((q) => (
                <tr key={q.borrow_request_id}>
                  <td style={Td}>{q.student_name}<br /><span style={{ font: '11px var(--font-body)', color: 'var(--ink-faint)' }}>{q.student_email}</span></td>
                  <td style={Td}>{q.equipment_type_name}</td>
                  <td style={{ ...Td, fontSize: 13 }}>{fmtDT(q.requested_start_at)} → {new Date(q.requested_return_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td>
                  <td style={{ ...Td, fontSize: 13 }}>{new Date(q.submitted_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}</td>
                  <td style={{ ...Td, textAlign: 'right' }}><Btn size="sm" onClick={() => setSelected(q)}>Process</Btn></td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
      )}
    </AppShell>
  );
}

function LendPanel({ item, onBack, onDone, onError }: { item: QueueItem; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [articles,     setArticles]     = useState<Article[]>([]);
  const [selectedArts, setSelectedArts] = useState<string[]>([]);
  const [agreedStart,  setAgreedStart]  = useState(item.requested_start_at.slice(0,16));
  const [agreedEnd,    setAgreedEnd]    = useState(item.requested_return_at.slice(0,16));
  const [rejReason,    setRejReason]    = useState('');
  const [mode,         setMode]         = useState<'approve'|'reject'|null>(null);
  const [busy,         setBusy]         = useState(false);

  useEffect(() => {
    listArticles({ equipmentTypeId: item.equipment_type_id, available: true })
      .then((r) => setArticles(r.articles)).catch(() => {});
  }, [item.equipment_type_id]);

  async function approve() {
    setBusy(true);
    try {
      await approveRequest(item.borrow_request_id);
      await lendPlatform({ borrowRequestId: item.borrow_request_id, articleIds: selectedArts, agreedStartAt: agreedStart, agreedReturnAt: agreedEnd });
      onDone('Request approved and equipment lent.');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    if (!rejReason.trim()) return;
    setBusy(true);
    try { await rejectRequest(item.borrow_request_id, rejReason); onDone('Request rejected.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Card style={{ padding: 'var(--sp-5)', maxWidth: 640 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', font: '13px var(--font-body)', padding: 0, marginBottom: 'var(--sp-4)' }}>← Back</button>
      <div style={secTitle}>Process Request — {item.equipment_type_name}</div>
      {[['Student', item.student_name], ['Email', item.student_email], ['Equipment', item.equipment_type_name], ['Window', `${fmtDT(item.requested_start_at)} → ${new Date(item.requested_return_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`]].map(([k,v]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr', padding: '8px 0', borderBottom: '1px solid var(--line-light)' }}>
          <span style={{ font: '500 13px var(--font-body)', color: 'var(--ink-muted)' }}>{k}</span>
          <span style={{ font: '14px var(--font-body)', color: 'var(--ink)' }}>{v}</span>
        </div>
      ))}

      {mode === null && (
        <div style={{ display: 'flex', gap: 8, marginTop: 'var(--sp-4)' }}>
          <Btn onClick={() => setMode('approve')}>Approve &amp; Lend</Btn>
          <Btn variant="danger" onClick={() => setMode('reject')}>Reject</Btn>
          <Btn variant="secondary" onClick={onBack}>Back</Btn>
        </div>
      )}

      {mode === 'approve' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <div><label style={lbl}>Agreed start</label><input style={inp} type="datetime-local" value={agreedStart} onChange={(e) => setAgreedStart(e.target.value)} /></div>
            <div><label style={lbl}>Agreed return</label><input style={inp} type="datetime-local" value={agreedEnd} onChange={(e) => setAgreedEnd(e.target.value)} /></div>
          </div>
          <label style={lbl}>Select articles to lend ({selectedArts.length} selected)</label>
          {articles.length === 0 ? <p style={{ font: '13px var(--font-body)', color: 'var(--danger)' }}>No available articles.</p> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 'var(--sp-3)' }}>
              {articles.map((a) => (
                <button key={a.article_id} type="button" onClick={() => setSelectedArts((prev) => prev.includes(a.article_id) ? prev.filter((id) => id !== a.article_id) : [...prev, a.article_id])}
                  style={{ padding: '5px 12px', borderRadius: 'var(--radius)', border: `2px solid ${selectedArts.includes(a.article_id) ? 'var(--teal)' : 'var(--line)'}`, background: selectedArts.includes(a.article_id) ? 'var(--teal-50)' : 'var(--white)', font: '12.5px var(--font-mono)', cursor: 'pointer' }}>
                  {a.barcode}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={approve} disabled={selectedArts.length === 0} loading={busy}>Confirm &amp; Lend</Btn>
            <Btn variant="secondary" onClick={() => setMode(null)}>Cancel</Btn>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <label style={lbl}>Rejection reason</label>
          <textarea value={rejReason} onChange={(e) => setRejReason(e.target.value)} rows={2} style={ta} placeholder="e.g. Equipment not available at this time." />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Btn variant="danger" onClick={reject} disabled={!rejReason.trim()} loading={busy}>Confirm Rejection</Btn>
            <Btn variant="secondary" onClick={() => setMode(null)}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function WalkinForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [types,     setTypes]     = useState<EquipmentType[]>([]);
  const [articles,  setArticles]  = useState<Article[]>([]);
  const [typeId,    setTypeId]    = useState(0);
  const [selectedArts,setSelectedArts] = useState<string[]>([]);
  const [guestName, setGuestName] = useState('');
  const [guestId,   setGuestId]   = useState('');
  const [guestPhone,setGuestPhone]= useState('');
  const [isFaculty, setIsFaculty] = useState(false);
  const [startAt,   setStartAt]   = useState('');
  const [endAt,     setEndAt]     = useState('');
  const [busy,      setBusy]      = useState(false);

  useEffect(() => { listTypes().then((r) => setTypes(r.types)).catch(() => {}); }, []);
  useEffect(() => {
    if (!typeId) { setArticles([]); return; }
    listArticles({ equipmentTypeId: typeId, available: true }).then((r) => setArticles(r.articles)).catch(() => {});
  }, [typeId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!typeId || selectedArts.length === 0) { onError('Select equipment type and at least one article.'); return; }
    setBusy(true);
    try {
      await lendWalkinGuest({ guestFullName: guestName, guestIdNumber: guestId, guestContactNumber: guestPhone, guestIsFaculty: isFaculty, equipmentTypeId: typeId, articleIds: selectedArts, agreedStartAt: startAt, agreedReturnAt: endAt });
      onDone('Walk-in lending recorded successfully.');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 'var(--sp-3)' }}>
      <div><label style={lbl}>Guest Name</label><input style={inp} value={guestName} onChange={(e) => setGuestName(e.target.value)} required /></div>
      <div><label style={lbl}>ID Number</label><input style={inp} value={guestId} onChange={(e) => setGuestId(e.target.value)} required /></div>
      <div><label style={lbl}>Contact</label><input style={inp} value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} required /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
        <input type="checkbox" id="isFaculty" checked={isFaculty} onChange={(e) => setIsFaculty(e.target.checked)} />
        <label htmlFor="isFaculty" style={{ font: '13.5px var(--font-body)', cursor: 'pointer' }}>Faculty member</label>
      </div>
      <div><label style={lbl}>Equipment Type</label><select style={inp} value={typeId} onChange={(e) => { setTypeId(Number(e.target.value)); setSelectedArts([]); }} required><option value={0}>Select…</option>{types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}</select></div>
      <div><label style={lbl}>From</label><input style={inp} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required /></div>
      <div><label style={lbl}>Return by</label><input style={inp} type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required /></div>
      {articles.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Articles ({selectedArts.length} selected)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {articles.map((a) => (
              <button key={a.article_id} type="button" onClick={() => setSelectedArts((p) => p.includes(a.article_id) ? p.filter((id) => id !== a.article_id) : [...p, a.article_id])}
                style={{ padding: '5px 12px', borderRadius: 'var(--radius)', border: `2px solid ${selectedArts.includes(a.article_id) ? 'var(--teal)' : 'var(--line)'}`, background: selectedArts.includes(a.article_id) ? 'var(--teal-50)' : 'var(--white)', font: '12.5px var(--font-mono)', cursor: 'pointer' }}>
                {a.barcode}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ gridColumn: '1 / -1' }}><Btn type="submit" loading={busy}>Record Walk-in Lending</Btn></div>
    </form>
  );
}

const secTitle: React.CSSProperties = { font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 4 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '13.5px var(--font-body)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none', background: 'var(--white)', color: 'var(--ink)' };
const ta: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', resize: 'vertical', outline: 'none' };
