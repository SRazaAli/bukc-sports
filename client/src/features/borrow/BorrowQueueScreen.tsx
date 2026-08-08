/**
 * Coordinator — Borrow Queue (BORROW-07..14).
 *
 * Queue is grouped by student — one row per student showing how many items
 * they've requested and their time window. Clicking "Review" opens a detail
 * panel listing ALL of that student's pending requests, each with individual
 * Approve / Reject controls. After approving an item the coordinator selects
 * the physical article(s) to hand out.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listArticles, type Article } from '../inventory/api.js';
import {
  listQueue, approveRequest, rejectRequest, lendPlatform, lendWalkinGuest,
  type QueueItem,
} from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

interface StudentGroup {
  student_id: string;
  student_name: string;
  student_email: string;
  items: QueueItem[];
  earliest_start: string;
  latest_return: string;
}

function groupByStudent(queue: QueueItem[]): StudentGroup[] {
  const map = new Map<string, StudentGroup>();
  for (const q of queue) {
    if (!map.has(q.student_id)) {
      map.set(q.student_id, {
        student_id: q.student_id, student_name: q.student_name,
        student_email: q.student_email, items: [],
        earliest_start: q.requested_start_at, latest_return: q.requested_return_at,
      });
    }
    const g = map.get(q.student_id)!;
    g.items.push(q);
    if (q.requested_start_at < g.earliest_start) g.earliest_start = q.requested_start_at;
    if (q.requested_return_at > g.latest_return) g.latest_return = q.requested_return_at;
  }
  return [...map.values()].sort((a, b) => a.earliest_start.localeCompare(b.earliest_start));
}

export default function BorrowQueueScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StudentGroup | null>(null);
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

  const flash = {
    ok:  (m: string) => { setNotice(m); setError(null); },
    err: (m: string) => { setError(m);  setNotice(null); },
  };

  const groups = queue ? groupByStudent(queue) : [];

  return (
    <PortalShell title="Borrow Queue" tint="slate">
      <div style={wrap}>
        {error  && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {selectedGroup ? (
          <StudentReviewPanel
            group={selectedGroup}
            onBack={() => { setSelectedGroup(null); void load(); }}
            onDone={(m) => { flash.ok(m); setSelectedGroup(null); void load(); }}
            onError={flash.err}
          />
        ) : (
          <>
            <Panel title="Pending Requests" action={
              <span style={{ fontSize: 12, color: '#8a949f' }}>
                {groups.length} student{groups.length !== 1 ? 's' : ''} waiting
              </span>
            }>
              {queue === null ? <p style={muted}>Loading…</p> : groups.length === 0 ? (
                <p style={muted}>No pending requests.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Student</th>
                      <th style={th}>Items Requested</th>
                      <th style={th}>Window</th>
                      <th style={th}>Submitted</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.student_id}>
                        <td style={td}>
                          <span style={{ fontWeight: 600 }}>{g.student_name}</span><br />
                          <span style={{ color: '#8a949f', fontSize: 12 }}>{g.student_email}</span>
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {g.items.map((item) => (
                              <span key={item.borrow_request_id} style={itemChip}>
                                {item.equipment_type_name}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ ...td, fontSize: 12, color: '#5c6773' }}>
                          {new Date(g.earliest_start).toLocaleDateString()}&nbsp;
                          {new Date(g.earliest_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {' → '}
                          {new Date(g.latest_return).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td style={{ ...td, fontSize: 12, color: '#5c6773' }}>
                          {new Date(g.items[0].submitted_at).toLocaleString()}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button style={reviewBtn} onClick={() => setSelectedGroup(g)}>
                            Review ({g.items.length})
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Walk-in Guest"
              action={<button style={ghostBtn} onClick={() => setShowWalkin((v) => !v)}>{showWalkin ? 'Close' : 'New Walk-in'}</button>}>
              {showWalkin
                ? <WalkinForm onDone={(m) => { flash.ok(m); setShowWalkin(false); }} onError={flash.err} />
                : <p style={muted}>Lend equipment directly to an unregistered guest — no prior request needed.</p>}
            </Panel>
          </>
        )}
      </div>
    </PortalShell>
  );
}

// ─────────────────────────── STUDENT REVIEW PANEL ────────────────
function StudentReviewPanel({ group, onBack, onDone, onError }: {
  group: StudentGroup;
  onBack: () => void;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  type ItemState = 'pending' | 'approving' | 'rejecting' | 'done';
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>(
    () => Object.fromEntries(group.items.map((i) => [i.borrow_request_id, 'pending' as ItemState]))
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  function setIS(id: string, s: ItemState) { setItemStates((p) => ({ ...p, [id]: s })); }
  function setBusyFor(id: string, v: boolean) { setBusy((p) => ({ ...p, [id]: v })); }

  async function approve(item: QueueItem) {
    setBusyFor(item.borrow_request_id, true);
    try { await approveRequest(item.borrow_request_id); setIS(item.borrow_request_id, 'approving'); }
    catch (e) { onError(errMsg(e)); } finally { setBusyFor(item.borrow_request_id, false); }
  }

  async function reject(item: QueueItem) {
    const reason = reasons[item.borrow_request_id] ?? '';
    if (!reason.trim()) { onError('A rejection reason is required.'); return; }
    setBusyFor(item.borrow_request_id, true);
    try {
      await rejectRequest(item.borrow_request_id, reason);
      setIS(item.borrow_request_id, 'done');
      setLocalNotice(`Rejected: ${item.equipment_type_name}`);
    } catch (e) { onError(errMsg(e)); } finally { setBusyFor(item.borrow_request_id, false); }
  }

  const allDone = group.items.every((i) => itemStates[i.borrow_request_id] === 'done');

  return (
    <Panel title={`Review — ${group.student_name}`}
      action={<button style={ghostBtn} onClick={onBack}>← Back to queue</button>}>

      <div style={{ marginBottom: 14, fontSize: 13, color: '#5c6773' }}>
        {group.student_email} &nbsp;·&nbsp;
        {new Date(group.earliest_start).toLocaleString()} → {new Date(group.latest_return).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>

      {localNotice && <div style={{ ...box.ok, marginBottom: 12 }}>{localNotice}</div>}

      {group.items.map((item) => {
        const state = itemStates[item.borrow_request_id];
        const isBusy = busy[item.borrow_request_id] ?? false;
        return (
          <div key={item.borrow_request_id} style={itemCard(state)}>
            <div style={itemCardHead}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{item.equipment_type_name}</span>
              <span style={{ ...statusChip, ...(state === 'done' ? chip.done : state === 'approving' ? chip.approved : chip.pending) }}>
                {state === 'done' ? '✓ Done' : state === 'approving' ? 'Approved — select article' : state === 'rejecting' ? 'Rejecting…' : 'Pending'}
              </span>
            </div>

            {state === 'pending' && (
              <div style={actionRow}>
                <button style={acceptBtn} disabled={isBusy} onClick={() => approve(item)}>
                  {isBusy ? 'Approving…' : 'Approve'}
                </button>
                <button style={rejectBtnStyle} onClick={() => setIS(item.borrow_request_id, 'rejecting')}>
                  Reject…
                </button>
              </div>
            )}

            {state === 'rejecting' && (
              <div style={{ marginTop: 10 }}>
                <label style={lbl}>Reason (sent to the student)</label>
                <textarea style={textarea} rows={2}
                  value={reasons[item.borrow_request_id] ?? ''}
                  onChange={(e) => setReasons((p) => ({ ...p, [item.borrow_request_id]: e.target.value }))}
                />
                <div style={actionRow}>
                  <button style={rejectBtnStyle}
                    disabled={isBusy || !(reasons[item.borrow_request_id] ?? '').trim()}
                    onClick={() => reject(item)}>
                    {isBusy ? 'Rejecting…' : 'Confirm Rejection'}
                  </button>
                  <button style={ghostBtn} onClick={() => setIS(item.borrow_request_id, 'pending')}>Cancel</button>
                </div>
              </div>
            )}

            {state === 'approving' && (
              <ArticlePickerInline item={item}
                onDone={(m) => { setIS(item.borrow_request_id, 'done'); setLocalNotice(m); }}
                onError={onError} />
            )}

            {state === 'done' && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#5c6773' }}>Processed</p>
            )}
          </div>
        );
      })}

      {allDone && (
        <button style={{ ...acceptBtn, marginTop: 8 }}
          onClick={() => onDone(`All items for ${group.student_name} processed.`)}>
          Done — back to queue
        </button>
      )}
    </Panel>
  );
}

// ─────────────────────────── ARTICLE PICKER ──────────────────────
function ArticlePickerInline({ item, onDone, onError }: {
  item: QueueItem; onDone: (m: string) => void; onError: (m: string) => void;
}) {
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
      onDone(`${item.equipment_type_name} lent to ${item.student_name}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: '#5c6773' }}>Select physical article(s) to hand out:</p>
      {articles.length === 0
        ? <p style={{ fontSize: 13, color: '#b3352b' }}>No available articles for this type.</p>
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {articles.map((a) => {
              const sel = selectedIds.includes(a.article_id);
              return (
                <button key={a.article_id} onClick={() => toggle(a.article_id)} style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                  border: `2px solid ${sel ? '#0a6ebd' : '#ccc'}`,
                  background: sel ? '#e8f3ff' : '#fff',
                  fontWeight: sel ? 600 : 400, color: sel ? '#0a6ebd' : '#333',
                }}>
                  {a.barcode}
                </button>
              );
            })}
          </div>
        )}
      <button style={acceptBtn} disabled={busy || selectedIds.length === 0} onClick={submit}>
        {busy ? 'Lending…' : `Hand Out (${selectedIds.length} selected)`}
      </button>
    </div>
  );
}

// ─────────────────────────── WALK-IN FORM ────────────────────────
function WalkinForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [guestName, setGuestName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listArticles({ state: 'AVAILABLE' }).then((r) => setArticles(r.articles)).catch((e) => onError(errMsg(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setSelectedIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : cur);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim()) { onError('Guest name is required.'); return; }
    if (selectedIds.length === 0) { onError('Select at least one article.'); return; }
    const now = new Date();
    const ret = new Date(now.getTime() + hours * 3600 * 1000);
    setBusy(true);
    try {
      await lendWalkinGuest({ guestName: guestName.trim(), articleIds: selectedIds, agreedStartAt: now.toISOString(), agreedReturnAt: ret.toISOString() });
      onDone(`Walk-in lend recorded for ${guestName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 480 }}>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={lbl}>Guest name</label>
          <input style={textInput} value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
        </div>
        <div>
          <label style={lbl}>Duration (hours)</label>
          <input type="number" min={1} max={12} style={textInput} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={lbl}>Articles</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {articles.map((a) => {
              const sel = selectedIds.includes(a.article_id);
              return (
                <button key={a.article_id} type="button" onClick={() => toggle(a.article_id)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                  border: `2px solid ${sel ? '#0a6ebd' : '#ccc'}`,
                  background: sel ? '#e8f3ff' : '#fff',
                  fontWeight: sel ? 600 : 400, color: sel ? '#0a6ebd' : '#333',
                }}>
                  {a.barcode} <span style={{ fontSize: 11, color: '#888' }}>({a.equipment_type_name})</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <button style={acceptBtn} disabled={busy}>{busy ? 'Lending…' : 'Record Walk-in Lend'}</button>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────── shared UI ───────────────────────────
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={panelBox}>
      <div style={panelHead}><span>{title}</span>{action}</div>
      <div style={panelBody}>{children}</div>
    </section>
  );
}

// ─── styles ──────────────────────────────────────────────────────
const wrap: React.CSSProperties = { maxWidth: 900, margin: '0 auto' };
const panelBox: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 8, marginBottom: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#26485f', background: 'linear-gradient(#fff,#f7f9fb)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '8px 10px', borderBottom: '1px solid #e5e5e5', background: '#f7f9fb' };
const td: React.CSSProperties = { padding: '12px 10px', borderBottom: '1px solid #eee', color: '#333', verticalAlign: 'top' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14, margin: 0 };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok:  { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
const itemChip: React.CSSProperties = { background: '#e7edf4', color: '#26485f', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 500 };
const itemCard = (state: string): React.CSSProperties => ({
  background: state === 'done' ? '#f0faf4' : state === 'approving' ? '#f0f7ff' : '#fff',
  border: `1px solid ${state === 'done' ? '#c2e6cd' : state === 'approving' ? '#bdd8f7' : '#e0e5ec'}`,
  borderRadius: 8, padding: 16, marginBottom: 12,
});
const itemCardHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 };
const statusChip: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 8px', borderRadius: 4 };
const chip = {
  pending:  { background: '#fef3c7', color: '#92400e' } as React.CSSProperties,
  approved: { background: '#dbeafe', color: '#1e40af' } as React.CSSProperties,
  done:     { background: '#d1fae5', color: '#065f46' } as React.CSSProperties,
};
const actionRow: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 };
const acceptBtn: React.CSSProperties = { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const rejectBtnStyle: React.CSSProperties = { background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: 'none', border: '1px solid #ccc', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', color: '#26485f' };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 4 };
const textarea: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box', resize: 'vertical' };
const textInput: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, boxSizing: 'border-box' };
