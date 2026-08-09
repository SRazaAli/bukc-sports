/**
 * Coordinator — Borrow Queue (BORROW-07..14).
 *
 * Queue is grouped by student: one row per student in the list view.
 * Clicking "Review" opens a detail panel showing ALL that student's pending
 * requests, each with its own approve/reject action.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listArticles, listTypes, type Article, type EquipmentType } from '../inventory/api.js';
import {
  listQueue, approveRequest, rejectRequest, lendPlatform, lendWalkinGuest,
  type QueueItem,
} from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) {
  return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.';
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });
}
function isExpired(requestedStartAt: string): boolean {
  return new Date(requestedStartAt).getTime() < Date.now();
}

// ─── Grouping helper ──────────────────────────────────────────────────────────

interface StudentGroup {
  studentId: string;
  studentName: string;
  studentEmail: string;
  requests: QueueItem[];
}

function groupByStudent(queue: QueueItem[]): StudentGroup[] {
  const map = new Map<string, StudentGroup>();
  for (const item of queue) {
    const existing = map.get(item.student_id);
    if (existing) {
      existing.requests.push(item);
    } else {
      map.set(item.student_id, {
        studentId: item.student_id,
        studentName: item.student_name,
        studentEmail: item.student_email,
        requests: [item],
      });
    }
  }
  return Array.from(map.values());
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BorrowQueueScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<StudentGroup | null>(null);
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
    ok: (m: string) => { setNotice(m); setError(null); void load(); },
    err: (m: string) => { setError(m); setNotice(null); },
  };

  const groups = queue ? groupByStudent(queue) : [];

  // Keep selectedStudent in sync after a reload (requests may have been approved/rejected)
  const syncedStudent = selectedStudent
    ? groups.find((g) => g.studentId === selectedStudent.studentId) ?? null
    : null;

  return (
    <PortalShell title="Borrow Queue" tint="slate">
      <div style={wrap}>
        {error  && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {syncedStudent ? (
          <StudentReviewPanel
            group={syncedStudent}
            onBack={() => setSelectedStudent(null)}
            onDone={(m) => { flash.ok(m); }}
            onError={flash.err}
          />
        ) : (
          <>
            {/* ── Pending requests table ── */}
            <Panel
              title="Pending Requests"
              action={
                groups.length >= 2 ? (
                  <ApproveAllButton
                    queue={queue ?? []}
                    onDone={flash.ok}
                    onError={flash.err}
                  />
                ) : undefined
              }
            >
              {queue === null ? (
                <p style={muted}>Loading…</p>
              ) : groups.length === 0 ? (
                <p style={muted}>No pending requests.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Student</th>
                      <th style={th}>Requests</th>
                      <th style={th}>Earliest request</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.studentId}>
                        <td style={td}>
                          <span style={studentName}>{g.studentName}</span>
                          <span style={studentEmail}>{g.studentEmail}</span>
                        </td>
                        <td style={td}>
                          <span style={countBadge}>{g.requests.length}</span>
                          <span style={itemNames}>
                            {g.requests.map((r) => r.equipment_type_name).join(', ')}
                          </span>
                        </td>
                        <td style={td}>
                          {fmtDate(g.requests[0]!.submitted_at)}<br />
                          <span style={{ color: '#6b7280', fontSize: 12 }}>
                            {fmtTime(g.requests[0]!.submitted_at)}
                          </span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button style={reviewBtn} onClick={() => setSelectedStudent(g)}>
                            Review →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            {/* ── Walk-in ── */}
            <Panel
              title="Walk-in Guest"
              action={
                <button style={ghostBtn} onClick={() => setShowWalkin((v) => !v)}>
                  {showWalkin ? 'Close' : 'New Walk-in'}
                </button>
              }
            >
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

// ─── Student review panel ─────────────────────────────────────────────────────

function StudentReviewPanel({ group, onBack, onDone, onError }: {
  group: StudentGroup;
  onBack: () => void;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  // Track which request is currently open for lending (post-approve)
  const [lendingItem, setLendingItem] = useState<QueueItem | null>(null);

  if (lendingItem) {
    return (
      <div>
        <button style={backBtn} onClick={() => setLendingItem(null)}>← Back to {group.studentName}'s requests</button>
        <ArticleSelectForm
          item={lendingItem}
          onDone={(m) => { setLendingItem(null); onDone(m); }}
          onError={onError}
        />
      </div>
    );
  }

  return (
    <div>
      <button style={backBtn} onClick={onBack}>← Back to queue</button>

      {/* Student header */}
      <div style={studentHeader}>
        <div>
          <h2 style={reviewTitle}>{group.studentName}</h2>
          <span style={reviewEmail}>{group.studentEmail}</span>
        </div>
        <span style={pendingCountBadge}>{group.requests.length} pending</span>
      </div>

      {/* One card per request */}
      <div style={requestStack}>
        {group.requests.map((item) => (
          <RequestItemCard
            key={item.borrow_request_id}
            item={item}
            onApproved={(m) => { onDone(m); }}
            onApprovedAndLend={(m) => { onDone(m); setLendingItem(item); }}
            onRejected={(m) => onDone(m)}
            onError={onError}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Per-request card inside the review panel ─────────────────────────────────

function RequestItemCard({ item, onApproved, onApprovedAndLend, onRejected, onError }: {
  item: QueueItem;
  onApproved: (m: string) => void;
  onApprovedAndLend: (m: string) => void;
  onRejected: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState<'approved' | 'rejected' | null>(null);

  async function handleApprove() {
    setBusy(true);
    try {
      await approveRequest(item.borrow_request_id);
      setDone(true);
      setOutcome('approved');
      onApproved(`Approved: ${item.equipment_type_name}.`);
    } catch (e) { onError(errMsg(e)); }
    finally { setBusy(false); }
  }

  async function handleApproveAndLend() {
    setBusy(true);
    try {
      await approveRequest(item.borrow_request_id);
      setDone(true);
      setOutcome('approved');
      onApprovedAndLend(`Approved: ${item.equipment_type_name}. Select articles to lend.`);
    } catch (e) { onError(errMsg(e)); }
    finally { setBusy(false); }
  }

  async function handleReject() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await rejectRequest(item.borrow_request_id, reason.trim());
      setDone(true);
      setOutcome('rejected');
      onRejected(`Rejected: ${item.equipment_type_name}.`);
    } catch (e) { onError(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ ...reqCard, ...(done ? reqCardDone : {}) }}>
      {/* Done overlay */}
      {done && (
        <div style={doneOverlay}>
          <span style={outcome === 'approved' ? approvedTag : rejectedTag}>
            {outcome === 'approved' ? '✓ Approved' : '✗ Rejected'}
          </span>
        </div>
      )}

      {/* Equipment + window */}
      <div style={reqCardHeader}>
        <span style={equipName}>{item.equipment_type_name}</span>
      </div>

      <div style={detailGrid}>
        <div style={detailCell}>
          <span style={detailLabel}>Date</span>
          <span style={detailValue}>{fmtDate(item.requested_start_at)}</span>
        </div>
        <div style={detailCell}>
          <span style={detailLabel}>Borrow time</span>
          <span style={detailValue}>{fmtTime(item.requested_start_at)}</span>
        </div>
        <div style={detailCell}>
          <span style={detailLabel}>Return by</span>
          <span style={detailValue}>{fmtTime(item.requested_return_at)}</span>
        </div>
        <div style={detailCell}>
          <span style={detailLabel}>Submitted</span>
          <span style={detailValue}>{fmtTime(item.submitted_at)}</span>
        </div>
      </div>

      {/* Actions */}
      {!done && isExpired(item.requested_start_at) && (
        <div style={expiredTag}>
          <span style={expiredIcon}>⏰</span>
          Request expired — borrow window has passed
        </div>
      )}

      {!done && !isExpired(item.requested_start_at) && !rejectOpen && (
        <div style={actionRow}>
          <button style={busy ? { ...approveBtn, opacity: 0.6 } : approveBtn} disabled={busy} onClick={handleApprove}>
            Approve
          </button>
          <button style={busy ? { ...approveLendBtn, opacity: 0.6 } : approveLendBtn} disabled={busy} onClick={handleApproveAndLend}>
            Approve &amp; Lend →
          </button>
          <button style={rejectOutlineBtn} disabled={busy} onClick={() => setRejectOpen(true)}>
            Reject
          </button>
        </div>
      )}

      {!done && !isExpired(item.requested_start_at) && rejectOpen && (
        <div style={rejectForm}>
          <input
            style={rejectInput}
            placeholder="Reason for rejection…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div style={actionRow}>
            <button
              style={reason.trim() && !busy ? confirmRejectBtn : { ...confirmRejectBtn, opacity: 0.5 }}
              disabled={!reason.trim() || busy}
              onClick={handleReject}
            >
              Confirm Reject
            </button>
            <button style={cancelBtn} disabled={busy} onClick={() => { setRejectOpen(false); setReason(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Article select form ──────────────────────────────────────────────────────

function ArticleSelectForm({ item, onDone, onError }: {
  item: QueueItem; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [idCardHeld, setIdCardHeld] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listArticles({ equipmentTypeId: item.equipment_type_id, state: 'AVAILABLE' })
      .then((r) => setArticles(r.articles))
      .catch((e) => onError(errMsg(e)));
  }, [item.equipment_type_id]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  async function lend() {
    if (selected.length === 0) { onError('Select at least one article.'); return; }
    setBusy(true);
    try {
      await lendPlatform({
        borrowRequestId: item.borrow_request_id,
        articleIds: selected,
        agreedStartAt: item.requested_start_at,
        agreedReturnAt: item.requested_return_at,
      });
      onDone(`Equipment lent to ${item.student_name}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={lendBox}>
      <h3 style={lendTitle}>Lend — {item.equipment_type_name}</h3>
      <p style={muted}>Select the physical article(s) to hand out to {item.student_name}.</p>
      {articles.length === 0 ? (
        <p style={{ ...muted, color: '#b91c1c' }}>No available articles for this type.</p>
      ) : (
        <div style={articleList}>
          {articles.map((a) => (
            <label key={a.article_id} style={articleRow}>
              <input type="checkbox" checked={selected.includes(a.article_id)} onChange={() => toggle(a.article_id)} />
              <span style={{ fontWeight: 500 }}>{a.barcode}</span>
              <span style={{ color: '#6b7280', fontSize: 13 }}>{a.condition_label ?? '—'}</span>
            </label>
          ))}
        </div>
      )}
      <label style={{ ...articleRow, marginTop: 12 }}>
        <input type="checkbox" checked={idCardHeld} onChange={(e) => setIdCardHeld(e.target.checked)} />
        ID card held
      </label>
      <div style={{ marginTop: 14 }}>
        <button
          style={selected.length > 0 && !busy ? approveBtn : { ...approveBtn, opacity: 0.5 }}
          disabled={selected.length === 0 || busy}
          onClick={lend}
        >
          {busy ? 'Processing…' : 'Confirm Lend'}
        </button>
      </div>
    </div>
  );
}

// ─── Approve All ──────────────────────────────────────────────────────────────

function ApproveAllButton({ queue, onDone, onError }: {
  queue: QueueItem[];
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleApproveAll() {
    setBusy(true);
    const failed: string[] = [];
    for (const item of queue) {
      try { await approveRequest(item.borrow_request_id); }
      catch { failed.push(item.equipment_type_name); }
    }
    setBusy(false);
    if (failed.length === 0) onDone(`All ${queue.length} requests approved.`);
    else if (failed.length < queue.length) onDone(`Approved with errors — failed: ${failed.join(', ')}.`);
    else onError('All approvals failed.');
  }

  return (
    <button style={busy ? { ...approveAllBtn, opacity: 0.6 } : approveAllBtn} disabled={busy} onClick={handleApproveAll}>
      {busy ? 'Approving…' : `Approve All (${queue.length})`}
    </button>
  );
}

// ─── Walk-in form ─────────────────────────────────────────────────────────────

function WalkinForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [typeId, setTypeId] = useState(0);
  const [articleIds, setArticleIds] = useState<string[]>([]);
  const [fullName, setFullName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [contact, setContact] = useState('');
  const [isFaculty, setIsFaculty] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listTypes().then((r) => setTypes(r.types)).catch(() => onError('Could not load equipment types.'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!typeId) { setArticles([]); setArticleIds([]); return; }
    listArticles({ equipmentTypeId: typeId, state: 'AVAILABLE' })
      .then((r) => setArticles(r.articles))
      .catch(() => onError('Could not load articles.'));
  }, [typeId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleArticle(id: string) {
    setArticleIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  async function submit() {
    setBusy(true);
    try {
      await lendWalkinGuest({
        equipmentTypeId: typeId, articleIds, fullName, idNumber,
        contactNumber: contact, isFaculty,
        agreedStartAt: new Date(startAt).toISOString(),
        agreedReturnAt: new Date(endAt).toISOString(),
      });
      onDone(`Walk-in lend recorded for ${fullName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={walkinGrid}>
      {([['Full name', fullName, setFullName], ['ID number', idNumber, setIdNumber], ['Contact', contact, setContact]] as [string, string, (v: string) => void][]).map(([label, val, set]) => (
        <div key={label} style={formField}>
          <label style={fieldLabel}>{label}</label>
          <input style={fieldInput} value={val} onChange={(e) => set(e.target.value)} />
        </div>
      ))}
      <div style={formField}>
        <label style={fieldLabel}>Equipment type</label>
        <select style={fieldInput} value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
          <option value={0}>— select —</option>
          {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
        </select>
      </div>
      {articles.length > 0 && (
        <div style={{ ...formField, gridColumn: '1 / -1' }}>
          <label style={fieldLabel}>Articles</label>
          <div style={articleList}>
            {articles.map((a) => (
              <label key={a.article_id} style={articleRow}>
                <input type="checkbox" checked={articleIds.includes(a.article_id)} onChange={() => toggleArticle(a.article_id)} />
                {a.barcode}
              </label>
            ))}
          </div>
        </div>
      )}
      <div style={formField}>
        <label style={fieldLabel}>Start</label>
        <input type="datetime-local" style={fieldInput} value={startAt} onChange={(e) => setStartAt(e.target.value)} />
      </div>
      <div style={formField}>
        <label style={fieldLabel}>Return by</label>
        <input type="datetime-local" style={fieldInput} value={endAt} onChange={(e) => setEndAt(e.target.value)} />
      </div>
      <label style={{ ...articleRow, gridColumn: '1 / -1' }}>
        <input type="checkbox" checked={isFaculty} onChange={(e) => setIsFaculty(e.target.checked)} />
        Faculty member
      </label>
      <div style={{ gridColumn: '1 / -1' }}>
        <button style={busy ? { ...approveBtn, opacity: 0.6 } : approveBtn} disabled={busy} onClick={submit}>
          {busy ? 'Recording…' : 'Record Walk-in Lend'}
        </button>
      </div>
    </div>
  );
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={panelWrap}>
      <div style={panelHeader}>
        <span style={panelTitleStyle}>{title}</span>
        {action}
      </div>
      <div style={panelBody}>{children}</div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 };
const muted: React.CSSProperties = { color: '#6b7280', fontSize: 14, margin: 0 };

const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
  ok:  { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
};

// Panel
const panelWrap: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' };
const panelHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', gap: 12 };
const panelTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#111' };
const panelBody: React.CSSProperties = { padding: '16px 18px' };

// Queue table
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e5e7eb', color: '#374151', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' };
const td: React.CSSProperties = { padding: '12px 10px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' };
const studentName: React.CSSProperties = { display: 'block', fontWeight: 600, color: '#111', fontSize: 14 };
const studentEmail: React.CSSProperties = { display: 'block', color: '#6b7280', fontSize: 12, marginTop: 2 };
const countBadge: React.CSSProperties = { display: 'inline-block', background: '#e0e7ff', color: '#3730a3', borderRadius: 12, padding: '1px 8px', fontSize: 12, fontWeight: 700, marginRight: 8 };
const itemNames: React.CSSProperties = { color: '#374151', fontSize: 13 };

// Student review panel
const studentHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' };
const reviewTitle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700, color: '#111' };
const reviewEmail: React.CSSProperties = { fontSize: 13, color: '#6b7280' };
const pendingCountBadge: React.CSSProperties = { background: '#fef3c7', color: '#92400e', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20 };
const requestStack: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

// Request item card
const reqCard: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px', background: '#fafafa', position: 'relative' };
const reqCardDone: React.CSSProperties = { opacity: 0.6 };
const reqCardHeader: React.CSSProperties = { marginBottom: 12 };
const equipName: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#111' };
const doneOverlay: React.CSSProperties = { position: 'absolute', top: 12, right: 14 };
const approvedTag: React.CSSProperties = { background: '#d1fae5', color: '#065f46', fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 12 };
const rejectedTag: React.CSSProperties = { background: '#fee2e2', color: '#991b1b', fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 12 };

// Detail grid
const detailGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px 16px', marginBottom: 14 };
const detailCell: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const detailLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' };
const detailValue: React.CSSProperties = { fontSize: 14, color: '#111', fontWeight: 500 };

// Action row
const actionRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };

// Buttons
const approveBtn: React.CSSProperties = { background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const approveLendBtn: React.CSSProperties = { background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const rejectOutlineBtn: React.CSSProperties = { background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const confirmRejectBtn: React.CSSProperties = { background: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const cancelBtn: React.CSSProperties = { background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: 'transparent', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer' };
const reviewBtn: React.CSSProperties = { background: 'transparent', color: '#2563eb', border: 'none', borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const approveAllBtn: React.CSSProperties = { background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const rejectForm: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const expiredTag: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 7, background: '#f3f4f6', color: '#6b7280', fontSize: 13, fontWeight: 500 };
const expiredIcon: React.CSSProperties = { fontSize: 15 };
const rejectInput: React.CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, width: '100%', boxSizing: 'border-box' };

// Back button
const backBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 20 };

// Lend box
const lendBox: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '20px', background: '#fff' };
const lendTitle: React.CSSProperties = { margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#111' };
const articleList: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const articleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' };

// Walk-in
const walkinGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' };
const formField: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151' };
const fieldInput: React.CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 };
