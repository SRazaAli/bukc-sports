/**
 * Student — My Borrows (BORROW-01..14). Redesigned with AppShell theme.
 * Backend unchanged: submitRequest, listMyRequests, listTypes.
 */
import { useEffect, useState, useCallback, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { listTypes, type EquipmentType } from '../inventory/api.js';
import { submitRequest, listMyRequests, type MyRequest } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
function fmtDT(d: string) { return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }

export default function MyBorrowsScreen() {
  const { user, loading } = useAuth();
  const [types,    setTypes]    = useState<EquipmentType[]>([]);
  const [requests, setRequests] = useState<MyRequest[]>([]);
  const [error,    setError]    = useState<string | null>(null);
  const [notice,   setNotice]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [t, r] = await Promise.all([listTypes(), listMyRequests()]); setTypes(t.types); setRequests(r.requests); }
    catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="My Borrows"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT') return <Navigate to="/home" replace />;

  return (
    <AppShell title="My Borrows">
      <PageHeader title="My Borrows" subtitle="Submit a same-day equipment request and track its status" />
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <div style={sectionTitle}>Request Equipment</div>
          <RequestForm types={types}
            onDone={(m) => { setNotice(m); setError(null); void load(); }}
            onError={(m) => { setError(m); setNotice(null); }} />
        </Card>
        <Card style={{ padding: 'var(--sp-5)' }}>
          <div style={sectionTitle}>My Requests</div>
          {requests.length === 0 ? <EmptyState title="No requests yet" body="Use the form above to submit your first equipment request." /> : (
            <TableWrapper>
              <thead><tr><th style={Th}>Equipment</th><th style={Th}>Requested window</th><th style={Th}>Status</th><th style={Th}>Note</th></tr></thead>
              <tbody>{requests.map((r) => (
                <tr key={r.borrow_request_id}>
                  <td style={Td}>{r.equipment_type_name}</td>
                  <td style={Td} style={{ ...Td, whiteSpace: 'nowrap' }}>{fmtDT(r.requested_start_at)} → {new Date(r.requested_return_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}</td>
                  <td style={Td}><Badge status={r.status} /></td>
                  <td style={{ ...Td, color: 'var(--danger)', fontSize: 13 }}>{r.rejection_reason ?? ''}</td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

function RequestForm({ types, onDone, onError }: { types: EquipmentType[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [typeId,  setTypeId]  = useState(0);
  const [startAt, setStartAt] = useState('');
  const [endAt,   setEndAt]   = useState('');
  const [busy,    setBusy]    = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!typeId) { onError('Select an equipment type.'); return; }
    setBusy(true);
    try { await submitRequest({ equipmentTypeId: typeId, requestedStartAt: startAt, requestedReturnAt: endAt }); onDone('Request submitted successfully.'); setTypeId(0); setStartAt(''); setEndAt(''); }
    catch (e) { onError(e instanceof ApiRequestError ? e.body.error : 'Could not submit.'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 'var(--sp-3)' }}>
      <div>
        <label style={lbl}>Equipment Type</label>
        <select style={inp} value={typeId} onChange={(e) => setTypeId(Number(e.target.value))} required>
          <option value={0}>Select type…</option>
          {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Borrow From</label>
        <input style={inp} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required />
      </div>
      <div>
        <label style={lbl}>Return By</label>
        <input style={inp} type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <Btn type="submit" loading={busy} style={{ width: '100%' }}>Submit Request</Btn>
      </div>
    </form>
  );
}

const sectionTitle: React.CSSProperties = { font: '600 14px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-4)' };
const lbl: React.CSSProperties = { display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '13.5px var(--font-body)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none', background: 'var(--white)', color: 'var(--ink)' };
