/**
 * Super Admin — Venue Approvals (VENUE-18..27, CONF-08/15). Final decision on
 * forwarded bookings: approve (subject to the exclusion constraint), reject,
 * or return to the Coordinator for re-evaluation (VENUE-22). Also basic venue
 * management, since something has to create the rows this feature depends on.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listAdminQueue, approveBooking, rejectBooking, returnForReeval, listVenues, createVenue, type AdminQueueBooking, type Venue } from './api.js';
import { listSportCategories, type SportCategory } from '../inventory/api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function VenueApprovalScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<AdminQueueBooking[] | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [selected, setSelected] = useState<AdminQueueBooking | null>(null);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, v, c] = await Promise.all([listAdminQueue(), listVenues(), listSportCategories()]);
      setQueue(q.queue); setVenues(v.venues); setCats(c.categories);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Venue Approvals"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'SUPER_ADMIN') return <Navigate to="/home" replace />;

  const flash = { ok: (m: string) => { setNotice(m); setError(null); }, err: (m: string) => { setError(m); setNotice(null); } };

  return (
    <PortalShell title="Venue Approvals" tint="navy">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {selected ? (
          <DecisionPanel item={selected} onBack={() => setSelected(null)}
            onDone={(m) => { flash.ok(m); setSelected(null); void load(); }} onError={flash.err} />
        ) : (
          <>
            <Panel title="Forwarded — Awaiting Your Decision">
              {queue === null ? <p style={muted}>Loading…</p> : queue.length === 0 ? (
                <p style={muted}>Nothing forwarded right now.</p>
              ) : (
                <table style={table}>
                  <thead><tr><th style={th}>Requester</th><th style={th}>Venue</th><th style={th}>Window</th><th style={th} /></tr></thead>
                  <tbody>
                    {queue.map((q) => (
                      <tr key={q.booking_id}>
                        <td style={td}>{q.requester_name}</td>
                        <td style={td}>{q.venue_name}</td>
                        <td style={td}>{q.sessionCount} session{q.sessionCount !== 1 ? 's' : ''}{q.firstStart ? ` · from ${new Date(q.firstStart).toLocaleDateString()}` : ''}</td>
                        <td style={{ ...td, textAlign: 'right' }}><button style={reviewBtn} onClick={() => setSelected(q)}>Decide</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Venues" action={<button style={ghostBtn} onClick={() => setShowVenueForm((v) => !v)}>{showVenueForm ? 'Close' : 'Add Venue'}</button>}>
              {showVenueForm && <VenueForm cats={cats} onDone={() => { flash.ok('Venue added.'); setShowVenueForm(false); void load(); }} onError={flash.err} />}
              <table style={table}>
                <thead><tr><th style={th}>Name</th><th style={th}>Sport</th><th style={th}>Capacity</th><th style={th}>Setting</th></tr></thead>
                <tbody>
                  {venues.map((v) => (
                    <tr key={v.venue_id}>
                      <td style={td}>{v.name}</td><td style={td}>{v.sport_category_name ?? '—'}</td>
                      <td style={td}>{v.capacity}</td><td style={td}>{v.is_indoor ? 'Indoor' : 'Outdoor'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </>
        )}
      </div>
    </PortalShell>
  );
}

function DecisionPanel({ item, onBack, onDone, onError }: {
  item: AdminQueueBooking; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<'none' | 'reject' | 'return'>('none');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try { await approveBooking(item.booking_id); onDone(`Booking approved for ${item.requester_name}.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    try { await rejectBooking(item.booking_id, text); onDone(`Booking rejected.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function returnIt() {
    setBusy(true);
    try { await returnForReeval(item.booking_id, text); onDone(`Returned to the Coordinator.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Panel title={`Decide — ${item.requester_name}`}>
      <Row label="Venue" value={item.venue_name} />
      <Row label="Purpose" value={item.purpose} />
      <Row label="Sessions" value={`${item.sessionCount} session${item.sessionCount !== 1 ? 's' : ''}${item.firstStart ? ` from ${new Date(item.firstStart).toLocaleDateString()}` : ''}`} />
      <Row label="Coordinator's note" value={item.feasibility_note ?? '—'} />

      {mode === 'none' && (
        <div style={actionRow}>
          <button style={acceptBtn} disabled={busy} onClick={approve}>Approve</button>
          <button style={rejectBtn} onClick={() => setMode('reject')}>Reject…</button>
          <button style={ghostBtn} onClick={() => setMode('return')}>Return to Coordinator…</button>
          <button style={ghostBtn} onClick={onBack}>Back</button>
        </div>
      )}
      {mode !== 'none' && (
        <div style={{ marginTop: 14 }}>
          <label style={lbl}>{mode === 'reject' ? 'Rejection reason' : 'Note for the Coordinator'}</label>
          <textarea style={textarea} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div style={actionRow}>
            <button style={mode === 'reject' ? rejectBtn : acceptBtn} disabled={!text.trim() || busy}
              onClick={mode === 'reject' ? reject : returnIt}>
              {mode === 'reject' ? 'Confirm rejection' : 'Send back'}
            </button>
            <button style={ghostBtn} onClick={() => setMode('none')}>Cancel</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function VenueForm({ cats, onDone, onError }: { cats: SportCategory[]; onDone: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState('');
  const [sportCategoryId, setSport] = useState(0);
  const [capacity, setCapacity] = useState(30);
  const [isIndoor, setIndoor] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await createVenue({ name, sportCategoryId: sportCategoryId || undefined, capacity, isIndoor }); onDone(); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={{ ...formGrid, marginBottom: 18 }}>
      <L label="Name"><input style={inp} value={name} onChange={(e) => setName(e.target.value)} required /></L>
      <L label="Sport (optional)"><select style={inp} value={sportCategoryId} onChange={(e) => setSport(Number(e.target.value))}>
        <option value={0}>Any</option>
        {cats.map((c) => <option key={c.sport_category_id} value={c.sport_category_id}>{c.name}</option>)}
      </select></L>
      <L label="Capacity"><input type="number" min={1} style={inp} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></L>
      <L label="Setting"><select style={inp} value={isIndoor ? '1' : '0'} onChange={(e) => setIndoor(e.target.value === '1')}>
        <option value="1">Indoor</option><option value="0">Outdoor</option>
      </select></L>
      <div style={{ gridColumn: '1 / -1' }}><button style={acceptBtn} disabled={busy}>{busy ? 'Adding…' : 'Add Venue'}</button></div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div style={detailRow}><div style={detailLabel}>{label}</div><div>{value}</div></div>;
}
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}><span>{title}</span>{action}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const textarea: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, resize: 'vertical', maxWidth: 480 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 560 };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 14, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const rejectBtn: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const detailRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14.5 };
const detailLabel: React.CSSProperties = { font: '600 13px var(--font-body)', color: '#555' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
