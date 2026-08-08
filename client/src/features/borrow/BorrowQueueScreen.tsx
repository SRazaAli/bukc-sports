/**
 * Coordinator — Borrow Queue (BORROW-07..14). Review pending platform requests
 * (approve → then lend against them by selecting physical articles), plus a
 * quick walk-in lending form for unregistered guests (BORROW-25).
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listTypes, listArticles, type EquipmentType, type Article } from '../inventory/api.js';
import { listQueue, approveRequest, rejectRequest, lendPlatform, lendWalkinGuest, type QueueItem } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function BorrowQueueScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWalkin, setShowWalkin] = useState(false);

  const load = useCallback(async () => {
    try { const r = await listQueue(); setQueue(r.queue); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Borrow Queue"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash = { ok: (m: string) => { setNotice(m); setError(null); }, err: (m: string) => { setError(m); setNotice(null); } };

  return (
    <PortalShell title="Borrow Queue" tint="slate">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {selected ? (
          <LendPanel item={selected} onBack={() => setSelected(null)}
            onDone={(m) => { flash.ok(m); setSelected(null); void load(); }} onError={flash.err} />
        ) : (
          <>
            <Panel title="Pending Requests">
              {queue === null ? <p style={muted}>Loading…</p> : queue.length === 0 ? (
                <p style={muted}>No pending requests.</p>
              ) : (
                <table style={table}>
                  <thead><tr><th style={th}>Student</th><th style={th}>Equipment</th><th style={th}>Available</th><th style={th}>Window</th><th style={th} /></tr></thead>
                  <tbody>
                    {queue.map((q) => (
                      <tr key={q.borrow_request_id}>
                        <td style={td}>
                          {q.student_name}
                          {q.is_bad_sport && <span style={badSportPill}>BAD SPORT</span>}
                          <br /><span style={{ color: '#8a949f', fontSize: 12 }}>{q.student_email}</span>
                        </td>
                        <td style={td}>{q.equipment_type_name}</td>
                        <td style={td}><span style={q.available_units > 0 ? stockOk : stockZero}>{q.available_units}</span></td>
                        <td style={td}>{new Date(q.requested_start_at).toLocaleString()} → {new Date(q.requested_return_at).toLocaleTimeString()}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button style={reviewBtn} onClick={() => setSelected(q)}>Review</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Walk-in Guest" action={<button style={ghostBtn} onClick={() => setShowWalkin((v) => !v)}>{showWalkin ? 'Close' : 'New Walk-in'}</button>}>
              {showWalkin
                ? <WalkinForm onDone={(m) => { flash.ok(m); setShowWalkin(false); }} onError={flash.err} />
                : <p style={muted}>Lend equipment directly to an unregistered guest, no prior request needed.</p>}
            </Panel>
          </>
        )}
      </div>
    </PortalShell>
  );
}

function LendPanel({ item, onBack, onDone, onError }: {
  item: QueueItem; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [stage, setStage] = useState<'decide' | 'lend'>('decide');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try { await approveRequest(item.borrow_request_id); setStage('lend'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    setBusy(true);
    try { await rejectRequest(item.borrow_request_id, reason); onDone(`Request rejected for ${item.student_name}.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  const noStock = item.available_units === 0;

  return (
    <Panel title={`Review Request — ${item.student_name}`}>
      <div style={{ marginBottom: 18 }}>
        <Row label="Equipment" value={item.equipment_type_name} />
        <Row label="Window" value={`${new Date(item.requested_start_at).toLocaleString()} → ${new Date(item.requested_return_at).toLocaleTimeString()}`} />
        <Row label="Student email" value={item.student_email} />
        <Row label="Available now" value={String(item.available_units)} />
      </div>

      {item.is_bad_sport && (
        <div style={badSportBanner}>⚠ This student has 3 or more late returns and is flagged as a Bad Sport.</div>
      )}

      {stage === 'decide' && noStock && !rejecting && (
        <div style={noStockBanner}>
          No units of this equipment are currently available. Reject the request (the student will be notified and can request again when stock returns) or leave it pending.
        </div>
      )}

      {stage === 'decide' && !rejecting && (
        <div style={actionRow}>
          <button style={acceptBtn} disabled={busy || noStock}
            title={noStock ? 'Cannot approve — no available stock' : undefined}
            onClick={accept}>Approve &amp; Lend</button>
          <button style={rejectBtn} onClick={() => setRejecting(true)}>Reject…</button>
          <button style={ghostBtn} onClick={onBack}>Back to queue</button>
        </div>
      )}
      {stage === 'decide' && rejecting && (
        <div>
          <label style={lbl}>Reason (sent to the student)</label>
          <textarea style={textarea} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div style={actionRow}>
            <button style={rejectBtn} disabled={!reason.trim() || busy} onClick={reject}>Confirm rejection</button>
            <button style={ghostBtn} onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        </div>
      )}
      {stage === 'lend' && (
        <PlatformLendForm item={item} onDone={onDone} onError={onError} />
      )}
    </Panel>
  );
}

function PlatformLendForm({ item, onDone, onError }: { item: QueueItem; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listArticles({ equipmentTypeId: item.equipment_type_id, state: 'AVAILABLE' })
      .then((r) => setArticles(r.articles)).catch((e) => onError(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.equipment_type_id]);

  function toggle(id: string) {
    setSelectedIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur);
  }

  async function submit() {
    if (selectedIds.length === 0) { onError('Select at least one article.'); return; }
    setBusy(true);
    try {
      await lendPlatform({
        borrowRequestId: item.borrow_request_id, articleIds: selectedIds,
        agreedStartAt: item.requested_start_at, agreedReturnAt: item.requested_return_at,
      });
      onDone(`Equipment lent to ${item.student_name}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <p style={{ ...muted, marginTop: 0 }}>Approved. Select the physical article(s) to hand out.</p>
      {articles.length === 0 ? <p style={muted}>No available articles of this type right now.</p> : (
        <div style={{ display: 'grid', gap: 6, marginBottom: 16 }}>
          {articles.map((a) => (
            <label key={a.article_id} style={checkRow}>
              <input type="checkbox" checked={selectedIds.includes(a.article_id)} onChange={() => toggle(a.article_id)} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>{a.barcode}</span>
              <span style={{ color: '#8a949f', fontSize: 12.5 }}>{a.current_condition_label}</span>
            </label>
          ))}
        </div>
      )}
      <button style={acceptBtn} disabled={busy || selectedIds.length === 0} onClick={submit}>Confirm &amp; Hand Out</button>
    </div>
  );
}

function WalkinForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [equipmentTypeId, setType] = useState(0);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [guestFullName, setName] = useState('');
  const [guestIdNumber, setIdNum] = useState('');
  const [guestContactNumber, setContact] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { listTypes().then((r) => setTypes(r.types)).catch(() => {}); }, []);
  useEffect(() => {
    if (!equipmentTypeId) { setArticles([]); return; }
    listArticles({ equipmentTypeId, state: 'AVAILABLE' }).then((r) => setArticles(r.articles)).catch(() => {});
  }, [equipmentTypeId]);

  function toggle(id: string) {
    setSelectedIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedIds.length === 0) { onError('Select at least one article.'); return; }
    setBusy(true);
    try {
      const now = new Date();
      const end = new Date(now.getTime() + 2 * 3600_000);
      await lendWalkinGuest({
        guestFullName, guestIdNumber, guestContactNumber, guestIsFaculty: false,
        equipmentTypeId, articleIds: selectedIds, agreedStartAt: now.toISOString(), agreedReturnAt: end.toISOString(),
      });
      onDone(`Equipment lent to walk-in guest ${guestFullName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={formGrid}>
      <L label="Guest name"><input style={inp} value={guestFullName} onChange={(e) => setName(e.target.value)} required /></L>
      <L label="ID number"><input style={inp} value={guestIdNumber} onChange={(e) => setIdNum(e.target.value)} required /></L>
      <L label="Contact number"><input style={inp} value={guestContactNumber} onChange={(e) => setContact(e.target.value)} required /></L>
      <L label="Equipment"><select style={inp} value={equipmentTypeId} onChange={(e) => setType(Number(e.target.value))} required>
        <option value={0}>Select</option>
        {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
      </select></L>
      {articles.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <span style={lbl}>Articles</span>
          <div style={{ display: 'grid', gap: 6 }}>
            {articles.map((a) => (
              <label key={a.article_id} style={checkRow}>
                <input type="checkbox" checked={selectedIds.includes(a.article_id)} onChange={() => toggle(a.article_id)} />
                <span style={{ fontFamily: 'var(--font-mono)' }}>{a.barcode}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div style={{ gridColumn: '1 / -1' }}><button style={acceptBtn} disabled={busy}>{busy ? 'Lending…' : 'Lend Equipment'}</button></div>
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
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 560 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const textarea: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, marginTop: 6, resize: 'vertical', maxWidth: 480 };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 14, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '8px 16px', fontSize: 14, cursor: 'pointer' };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const rejectBtn: React.CSSProperties = { background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const detailRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: '140px 1fr', padding: '8px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14.5 };
const detailLabel: React.CSSProperties = { font: '600 13px var(--font-body)', color: '#555' };
const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 };
const badSportPill: React.CSSProperties = { font: '700 9.5px var(--font-mono)', padding: '2px 7px', borderRadius: 4, background: '#fbe9e7', color: '#b3352b', marginLeft: 8, verticalAlign: 'middle', letterSpacing: '0.03em' };
const stockOk: React.CSSProperties = { font: '600 14px var(--font-mono)', color: '#1f7a45' };
const stockZero: React.CSSProperties = { font: '600 14px var(--font-mono)', color: '#b3352b' };
const badSportBanner: React.CSSProperties = { background: '#fef0ee', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '8px 12px', marginBottom: 14, fontSize: 13.5 };
const noStockBanner: React.CSSProperties = { background: '#fdf1e3', color: '#8a4413', border: '1px solid #f3d3ba', borderRadius: 4, padding: '8px 12px', marginBottom: 14, fontSize: 13.5 };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
