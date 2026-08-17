/**
 * Coordinator — Borrow Queue.
 * Requests are grouped by request_group_id into logical "group" units.
 * A group may contain 1 item (single borrow) or N items (kit/multi-item).
 * Approve & Lend opens a single scrollable form showing article selectors
 * for every equipment type in the group (BORROW-11).
 * ID card checkbox (BORROW-06) gates the final Confirm Lend button.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listArticles, type Article } from '../inventory/api.js';
import {
  listQueue, approveGroup, rejectRequest, lendGroup,
  lendWalkinGuest, lendWalkinRegistered, resolveRegisteredBorrower,
  type QueueItem, type QueueGroup, type RegisteredBorrower,
} from './api.js';
import { listTypes, type EquipmentType } from '../inventory/api.js';
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

// Group flat QueueItem[] into QueueGroup[] by request_group_id
function groupItems(queue: QueueItem[]): QueueGroup[] {
  const map = new Map<string, QueueGroup>();
  for (const item of queue) {
    const g = map.get(item.request_group_id);
    if (g) {
      g.items.push(item);
    } else {
      map.set(item.request_group_id, {
        groupId: item.request_group_id,
        studentId: item.student_id,
        studentName: item.student_name,
        studentEmail: item.student_email,
        items: [item],
        submittedAt: item.submitted_at,
        isBadSport: item.is_bad_sport,
      });
    }
  }
  // Sort groups by earliest submitted_at
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BorrowQueueScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<QueueGroup | null>(null);
  const [lendingGroup, setLendingGroup] = useState<QueueGroup | null>(null);
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

  const groups = queue ? groupItems(queue) : [];

  // Keep selection in sync after reload
  const syncedGroup = selectedGroup
    ? groups.find((g) => g.groupId === selectedGroup.groupId) ?? null
    : null;

  // Lend view
  if (lendingGroup) {
    return (
      <PortalShell title="Borrow Queue" tint="slate">
        <div style={wrap}>
          {error && <div style={box.err}>{error}</div>}
          <GroupLendForm
            group={lendingGroup}
            onBack={() => setLendingGroup(null)}
            onDone={(m) => { setLendingGroup(null); flash.ok(m); }}
            onError={flash.err}
          />
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell title="Borrow Queue" tint="slate">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {syncedGroup ? (
          <GroupReviewPanel
            group={syncedGroup}
            onBack={() => setSelectedGroup(null)}
            onDone={(m) => { flash.ok(m); setSelectedGroup(null); }}
            onLend={(g) => { setSelectedGroup(null); setLendingGroup(g); }}
            onError={flash.err}
          />
        ) : (
          <>
            <Panel title="Pending Requests">
              {queue === null ? (
                <p style={muted}>Loading…</p>
              ) : groups.length === 0 ? (
                <p style={muted}>No pending requests.</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Student</th>
                      <th style={th}>Items</th>
                      <th style={th}>Submitted</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.groupId}>
                        <td style={td}>
                          <span style={sName}>{g.studentName}</span>
                          <span style={sEmail}>{g.studentEmail}</span>
                          {g.isBadSport && <span style={badSportBadge}>⚠ Late returner</span>}
                        </td>
                        <td style={td}>
                          {g.items.length > 1 && (
                            <span style={countBadge}>{g.items.length}</span>
                          )}
                          <span style={itemNames}>{g.items.map((i) => i.equipment_type_name).join(', ')}</span>
                        </td>
                        <td style={td}>
                          {fmtDate(g.submittedAt)}<br />
                          <span style={{ color: '#6b7280', fontSize: 12 }}>{fmtTime(g.submittedAt)}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button style={reviewBtn} onClick={() => setSelectedGroup(g)}>Review →</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel
              title="Walk-in Lending"
              action={
                <button style={ghostBtn} onClick={() => setShowWalkin((v) => !v)}>
                  {showWalkin ? 'Close' : 'New Walk-in'}
                </button>
              }
            >
              {showWalkin
                ? <WalkinFormTabbed onDone={(m) => { flash.ok(m); setShowWalkin(false); }} onError={flash.err} />
                : <p style={muted}>Lend equipment directly to a registered student or unregistered guest.</p>}
            </Panel>
          </>
        )}
      </div>
    </PortalShell>
  );
}

// ─── Group review panel ───────────────────────────────────────────────────────

function GroupReviewPanel({ group, onBack, onDone, onLend, onError }: {
  group: QueueGroup;
  onBack: () => void;
  onDone: (m: string) => void;
  onLend: (g: QueueGroup) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const expired = group.items.some((i) => isExpired(i.requested_start_at));
  const first = group.items[0]!;

  async function handleApprove() {
    setBusy(true);
    try {
      await approveGroup(group.groupId);
      setDone(true);
      onDone(`Approved request for ${group.studentName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  async function handleApproveAndLend() {
    setBusy(true);
    try {
      await approveGroup(group.groupId);
      onLend(group);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  async function handleReject() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      // Reject each row individually (each has its own reject endpoint)
      for (const item of group.items) {
        await rejectRequest(item.borrow_request_id, reason.trim());
      }
      setDone(true);
      onDone(`Rejected request for ${group.studentName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div>
      <button style={backBtn} onClick={onBack}>← Back to queue</button>

      <div style={studentHeader}>
        <div>
          <h2 style={reviewTitle}>{group.studentName}</h2>
          <span style={reviewEmail}>{group.studentEmail}</span>
        </div>
        <span style={pendingBadge}>{group.items.length} item{group.items.length > 1 ? 's' : ''} pending</span>
      </div>

      {/* Items summary */}
      <div style={reqCard}>
        <div style={detailGrid}>
          <div style={detailCell}>
            <span style={detailLabel}>Date</span>
            <span style={detailValue}>{fmtDate(first.requested_start_at)}</span>
          </div>
          <div style={detailCell}>
            <span style={detailLabel}>Borrow time</span>
            <span style={detailValue}>{fmtTime(first.requested_start_at)}</span>
          </div>
          <div style={detailCell}>
            <span style={detailLabel}>Return by</span>
            <span style={detailValue}>{fmtTime(first.requested_return_at)}</span>
          </div>
          <div style={detailCell}>
            <span style={detailLabel}>Submitted</span>
            <span style={detailValue}>{fmtTime(first.submitted_at)}</span>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <span style={detailLabel}>Equipment</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            {group.items.map((item) => (
              <div key={item.borrow_request_id} style={itemRow}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{item.equipment_type_name}</span>
                <span style={{ color: '#6b7280', fontSize: 12 }}>{item.lending_unit === 'PAIR' ? 'Pair' : 'Single'} · {item.available_units} available</span>
              </div>
            ))}
          </div>
        </div>

        {done && <div style={approvedTag}>✓ Actioned</div>}

        {!done && expired && (
          <div style={expiredTag}><span>⏰</span> Request expired — borrow window has passed</div>
        )}

        {!done && !expired && !rejectOpen && (
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

        {!done && !expired && rejectOpen && (
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
    </div>
  );
}

// ─── Group lend form ──────────────────────────────────────────────────────────
// One scrollable form with an article selector per equipment type in the group.

interface TypeArticles {
  typeId: number;
  typeName: string;
  lendingUnit: 'SINGLE' | 'PAIR';
  articles: Article[];
  selected: string[];
}

function GroupLendForm({ group, onBack, onDone, onError }: {
  group: QueueGroup;
  onBack: () => void;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [typeArticles, setTypeArticles] = useState<TypeArticles[]>([]);
  const [idCardHeld, setIdCardHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const first = group.items[0]!;

  useEffect(() => {
    async function load() {
      try {
        const results = await Promise.all(
          group.items.map(async (item) => {
            const r = await listArticles({ equipmentTypeId: item.equipment_type_id, state: 'AVAILABLE' });
            return {
              typeId: item.equipment_type_id,
              typeName: item.equipment_type_name,
              lendingUnit: item.lending_unit,
              articles: r.articles,
              selected: [] as string[],
            };
          }),
        );
        setTypeArticles(results);
      } catch (e) {
        setLoadError(errMsg(e));
      }
    }
    void load();
  }, [group]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectArticle(typeId: number, articleId: string) {
    setTypeArticles((prev) =>
      prev.map((ta) => {
        if (ta.typeId !== typeId) return ta;
        return { ...ta, selected: ta.selected[0] === articleId ? [] : [articleId] };
      }),
    );
  }

  // Every type must have ≥ 1 article selected
  const allSelected = typeArticles.length > 0 && typeArticles.every((ta) => ta.selected.length > 0);
  const canLend = allSelected && idCardHeld;

  async function handleLend() {
    if (!canLend) return;
    setBusy(true);
    try {
      const articlesPerType: Record<number, string[]> = {};
      for (const ta of typeArticles) {
        articlesPerType[ta.typeId] = ta.selected;
      }
      await lendGroup({
        groupId: group.groupId,
        articlesPerType,
        agreedStartAt: first.requested_start_at,
        agreedReturnAt: first.requested_return_at,
      });
      onDone(`Equipment lent to ${group.studentName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={lendBox}>
      <button style={backBtn} onClick={onBack}>← Back</button>

      <div style={studentHeader}>
        <div>
          <h2 style={reviewTitle}>Lend to {group.studentName}</h2>
          <span style={reviewEmail}>{group.studentEmail}</span>
        </div>
      </div>

      {/* Time window summary */}
      <div style={timeSummary}>
        <span style={detailLabel}>Window</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {fmtDate(first.requested_start_at)} · {fmtTime(first.requested_start_at)} – {fmtTime(first.requested_return_at)}
        </span>
      </div>

      {loadError && <div style={box.err}>{loadError}</div>}

      {/* One article selector per equipment type */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 16 }}>
        {typeArticles.map((ta) => (
          <div key={ta.typeId} style={typeSection}>
            <div style={typeSectionHeader}>
              <span style={typeSectionTitle}>{ta.typeName}</span>
              <span style={typeSectionMeta}>
                {ta.lendingUnit === 'PAIR' ? 'Pair-based' : 'Single unit'}
              </span>
            </div>

            {ta.articles.length === 0 ? (
              <p style={{ ...muted, color: '#b91c1c', margin: 0 }}>No available articles for this type.</p>
            ) : (
              <div style={articleList}>
                {ta.articles.map((a) => {
                  const checked = ta.selected[0] === a.article_id;
                  return (
                    <label key={a.article_id} style={articleRow}>
                      <input
                        type="radio"
                        name={`article-type-${ta.typeId}`}
                        checked={ta.selected[0] === a.article_id}
                        onChange={() => selectArticle(ta.typeId, a.article_id)}
                      />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{a.barcode}</span>
                      <span style={{ color: '#6b7280', fontSize: 12 }}>{a.current_condition_label}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {ta.selected.length > 0 && (
              <p style={selectionHint}>
                ✓ {ta.selected.length} article{ta.selected.length > 1 ? 's' : ''} selected
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ID card gate (BORROW-06) */}
      <label style={idCardLabel}>
        <input
          type="checkbox"
          checked={idCardHeld}
          onChange={(e) => setIdCardHeld(e.target.checked)}
        />
        <span>
          <strong>ID card held as collateral</strong> — I have taken the student's physical ID card.
          Equipment will not be returned until the card is back with the student.
        </span>
      </label>

      {!idCardHeld && allSelected && (
        <p style={idCardWarning}>You must confirm the ID card is held before completing the lend.</p>
      )}

      <div style={{ marginTop: 18 }}>
        <button
          style={canLend && !busy ? confirmLendBtn : { ...confirmLendBtn, opacity: 0.45, cursor: 'not-allowed' }}
          disabled={!canLend || busy}
          onClick={handleLend}
        >
          {busy ? 'Processing…' : 'Confirm Lend'}
        </button>
      </div>
    </div>
  );
}

// ─── Walk-in tabbed wrapper ───────────────────────────────────────────────────

function WalkinFormTabbed({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [tab, setTab] = useState<'registered' | 'guest'>('registered');
  return (
    <div>
      <div style={tabBar}>
        <button style={tab === 'registered' ? activeTab : inactiveTab} onClick={() => setTab('registered')}>
          Registered Student
        </button>
        <button style={tab === 'guest' ? activeTab : inactiveTab} onClick={() => setTab('guest')}>
          Unregistered Guest
        </button>
      </div>
      {tab === 'registered'
        ? <WalkinRegisteredForm onDone={onDone} onError={onError} />
        : <WalkinGuestForm onDone={onDone} onError={onError} />}
    </div>
  );
}

// ─── Registered walk-in form ──────────────────────────────────────────────────

function WalkinRegisteredForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [types, setTypes] = useState<EquipmentType[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [typeId, setTypeId] = useState(0);
  const [articleIds, setArticleIds] = useState<string[]>([]);
  const [enrollmentNo, setEnrollmentNo] = useState('');
  const [resolvedBorrower, setResolvedBorrower] = useState<RegisteredBorrower | null>(null);
  const [resolving, setResolving] = useState(false);
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

  async function resolve() {
    if (!enrollmentNo.trim()) return;
    setResolving(true);
    setResolvedBorrower(null);
    try {
      const r = await resolveRegisteredBorrower(enrollmentNo.trim());
      setResolvedBorrower(r.borrower);
    } catch (e) { onError(errMsg(e)); } finally { setResolving(false); }
  }

  function toggleArticle(id: string) {
    setArticleIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  }

  async function submit() {
    if (!resolvedBorrower) { onError('Look up a student first.'); return; }
    if (!typeId) { onError('Select equipment type.'); return; }
    if (articleIds.length === 0) { onError('Select at least one article.'); return; }
    setBusy(true);
    try {
      await lendWalkinRegistered({
        enrollmentNo: resolvedBorrower.enrollmentNo,
        equipmentTypeId: typeId, articleIds,
        agreedStartAt: new Date(startAt).toISOString(),
        agreedReturnAt: new Date(endAt).toISOString(),
      });
      onDone(`Walk-in lend recorded for ${resolvedBorrower.fullName}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={walkinGrid}>
      <div style={{ ...formField, gridColumn: '1 / -1' }}>
        <label style={fieldLabel}>Enrollment number</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...fieldInput, flex: 1 }}
            placeholder="84-024000-123"
            value={enrollmentNo}
            onChange={(e) => { setEnrollmentNo(e.target.value); setResolvedBorrower(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void resolve(); }}
          />
          <button style={resolveBtn} disabled={resolving || !enrollmentNo.trim()} onClick={() => void resolve()}>
            {resolving ? 'Looking up…' : 'Look up'}
          </button>
        </div>
        {resolvedBorrower && (
          <div style={resolvedCard}>
            <span style={resolvedName}>{resolvedBorrower.fullName}</span>
            <span style={resolvedDetail}>{resolvedBorrower.enrollmentNo} · {resolvedBorrower.department ?? 'N/A'}</span>
            <span style={resolvedDetail}>{resolvedBorrower.email}</span>
          </div>
        )}
      </div>

      <div style={formField}>
        <label style={fieldLabel}>Equipment type</label>
        <select style={fieldInput} value={typeId} onChange={(e) => setTypeId(Number(e.target.value))}>
          <option value={0}>— select —</option>
          {types.map((t) => <option key={t.equipment_type_id} value={t.equipment_type_id}>{t.name}</option>)}
        </select>
      </div>
      <div style={formField} />
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
      <div style={{ gridColumn: '1 / -1' }}>
        <button style={busy ? { ...approveBtn, opacity: 0.6 } : approveBtn} disabled={busy || !resolvedBorrower} onClick={() => void submit()}>
          {busy ? 'Recording…' : 'Record Walk-in Lend'}
        </button>
      </div>
    </div>
  );
}

// ─── Guest walk-in form ───────────────────────────────────────────────────────

function WalkinGuestForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
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
        equipmentTypeId: typeId, articleIds,
        guestFullName: fullName, guestIdNumber: idNumber,
        guestContactNumber: contact, guestIsFaculty: isFaculty,
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
        <button style={busy ? { ...approveBtn, opacity: 0.6 } : approveBtn} disabled={busy} onClick={() => void submit()}>
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
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
};

const panelWrap: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' };
const panelHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', gap: 12 };
const panelTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#111' };
const panelBody: React.CSSProperties = { padding: '16px 18px' };

const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e5e7eb', color: '#374151', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' };
const td: React.CSSProperties = { padding: '12px 10px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' };
const sName: React.CSSProperties = { display: 'block', fontWeight: 600, color: '#111', fontSize: 14 };
const sEmail: React.CSSProperties = { display: 'block', color: '#6b7280', fontSize: 12, marginTop: 2 };
const badSportBadge: React.CSSProperties = { display: 'inline-block', marginTop: 4, background: '#fef3c7', color: '#92400e', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 600 };
const countBadge: React.CSSProperties = { display: 'inline-block', background: '#e0e7ff', color: '#3730a3', borderRadius: 12, padding: '1px 8px', fontSize: 12, fontWeight: 700, marginRight: 8 };
const itemNames: React.CSSProperties = { color: '#374151', fontSize: 13 };

const studentHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' };
const reviewTitle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 700, color: '#111' };
const reviewEmail: React.CSSProperties = { fontSize: 13, color: '#6b7280' };
const pendingBadge: React.CSSProperties = { background: '#fef3c7', color: '#92400e', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20 };

const reqCard: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '16px', background: '#fafafa' };
const detailGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px 16px', marginBottom: 16 };
const detailCell: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const detailLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' };
const detailValue: React.CSSProperties = { fontSize: 14, color: '#111', fontWeight: 500 };
const itemRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7 };

const actionRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 };
const approveBtn: React.CSSProperties = { background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const approveLendBtn: React.CSSProperties = { background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const rejectOutlineBtn: React.CSSProperties = { background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const confirmRejectBtn: React.CSSProperties = { background: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const cancelBtn: React.CSSProperties = { background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: 'transparent', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer' };
const reviewBtn: React.CSSProperties = { background: 'transparent', color: '#2563eb', border: 'none', borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const rejectForm: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 };
const rejectInput: React.CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, width: '100%', boxSizing: 'border-box' };
const approvedTag: React.CSSProperties = { display: 'inline-block', background: '#d1fae5', color: '#065f46', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 12 };
const expiredTag: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 7, background: '#f3f4f6', color: '#6b7280', fontSize: 13, fontWeight: 500, marginTop: 8 };

const backBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 20 };

// Lend form styles
const lendBox: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '20px', background: '#fff' };
const timeSummary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '10px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' };
const typeSection: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px', background: '#fafafa' };
const typeSectionHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 };
const typeSectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#111' };
const typeSectionMeta: React.CSSProperties = { fontSize: 12, color: '#6b7280', background: '#e5e7eb', padding: '2px 8px', borderRadius: 10 };
const articleList: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const articleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' };
const selectionHint: React.CSSProperties = { margin: '8px 0 0', fontSize: 12, color: '#065f46', fontWeight: 600 };
const idCardLabel: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 20, padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 14, cursor: 'pointer' };
const idCardWarning: React.CSSProperties = { margin: '8px 0 0', fontSize: 13, color: '#92400e', fontWeight: 500 };
const confirmLendBtn: React.CSSProperties = { background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', width: '100%' };

// Walk-in
const walkinGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' };
const formField: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151' };
const fieldInput: React.CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 };
const tabBar: React.CSSProperties = { display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #e5e7eb' };
const activeTab: React.CSSProperties = { background: 'none', border: 'none', borderBottom: '2px solid #1d4ed8', color: '#1d4ed8', fontWeight: 700, fontSize: 13, padding: '8px 18px', cursor: 'pointer', marginBottom: -1 };
const inactiveTab: React.CSSProperties = { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#6b7280', fontWeight: 500, fontSize: 13, padding: '8px 18px', cursor: 'pointer', marginBottom: -1 };
const resolveBtn: React.CSSProperties = { background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
const resolvedCard: React.CSSProperties = { marginTop: 8, padding: '10px 14px', borderRadius: 7, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', flexDirection: 'column', gap: 2 };
const resolvedName: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#065f46' };
const resolvedDetail: React.CSSProperties = { fontSize: 12, color: '#047857' };
