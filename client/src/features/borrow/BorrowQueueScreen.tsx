/**
 * Coordinator — Borrow Queue.
 * Requests are grouped by request_group_id into logical "group" units.
 * A group may contain 1 item (single borrow) or N items (kit/multi-item).
 *
 * Flow (fixed so equipment can't be handed out days early):
 *   1. Approve — any time before the requested start. The request then moves
 *      to "Approved — ready to collect".
 *   2. Lend — only on the requested day, when the student is at the desk with
 *      their university card. The coordinator searches the student, types the
 *      enrollment number printed on the card (must match the account) and
 *      picks the articles. The server re-checks both rules.
 *   3. Submitted — the lent request stays under "On loan" until the student
 *      hands everything back at the desk. The coordinator presses Submitted:
 *      Usage History records Completed — Earlier (well before the end),
 *      Completed (last 10 min of the window) or Completed — Late (after it).
 *   No lending on Saturdays/Sundays or once the window has ended.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { HideInAppShell } from '../../components/AppShellContext.js';
import { useBackStep } from '../../components/backStack.js';
import { listArticles, type Article } from '../inventory/api.js';
import {
  listQueue, approveGroup, rejectRequest,
  lendWalkinGuest, lendWalkinRegistered, resolveRegisteredBorrower,
  type QueueItem, type QueueGroup, type RegisteredBorrower,
} from './api.js';
import {
  getDeskOverview, lendWithCard, normalizeEnrollment, notifyBorrowBadgesChanged,
  listOnLoan, markSubmitted, previewOutcome, OUTCOME_LABEL,
  type DeskOverview, type ReadyGroup, type OnLoanGroup,
} from './deskApi.js';
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

// Same rule as the server (deskService.lendWindow): lending opens on the
// requested day (Pakistan time) and closes at the requested return time.
const karachiDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function lendState(startIso: string, endIso: string): { ok: boolean; why: string | null; today: boolean } {
  const now = new Date();
  const start = new Date(startIso);
  const today = karachiDay(now) === karachiDay(start);
  if (karachiDay(now) < karachiDay(start)) {
    return { ok: false, today, why: `Lending opens on ${fmtDate(startIso)} — when the student brings their university card.` };
  }
  if (now.getTime() >= new Date(endIso).getTime()) return { ok: false, today, why: 'The borrow window has passed.' };
  return { ok: true, today, why: null };
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

/** Everything the lend form needs — built from a pending group or an approved one. */
interface LendTarget {
  groupId: string; studentName: string; studentEmail: string; enrollmentNo: string | null;
  startAt: string; returnAt: string;
  items: Array<{ typeId: number; typeName: string; lendingUnit: 'SINGLE' | 'PAIR' }>;
}
const targetFromPending = (g: QueueGroup, enrollmentNo: string | null): LendTarget => ({
  groupId: g.groupId, studentName: g.studentName, studentEmail: g.studentEmail, enrollmentNo,
  startAt: g.items[0]!.requested_start_at, returnAt: g.items[0]!.requested_return_at,
  items: g.items.map((i) => ({ typeId: i.equipment_type_id, typeName: i.equipment_type_name, lendingUnit: i.lending_unit })),
});
const targetFromReady = (g: ReadyGroup): LendTarget => ({
  groupId: g.groupId, studentName: g.studentName, studentEmail: g.studentEmail, enrollmentNo: g.enrollmentNo,
  startAt: g.startAt, returnAt: g.returnAt,
  items: g.items.map((i) => ({ typeId: i.equipmentTypeId, typeName: i.equipmentTypeName, lendingUnit: i.lendingUnit })),
});

/** Case-insensitive match on name, email or enrollment (dashes optional). */
function matches(q: string, name: string, email: string, enrollment: string | null) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, '');
  return name.toLowerCase().includes(s) || email.toLowerCase().includes(s)
    || (!!enrollment && (enrollment.toLowerCase().includes(s) || (digits.length >= 3 && enrollment.replace(/\D/g, '').includes(digits))));
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function BorrowQueueScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [desk, setDesk] = useState<DeskOverview | null>(null);
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<QueueGroup | null>(null);
  const [lendingGroup, setLendingGroup] = useState<LendTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWalkin, setShowWalkin] = useState(false);
  const [onLoan, setOnLoan] = useState<OnLoanGroup[] | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, d, l] = await Promise.all([listQueue(), getDeskOverview(), listOnLoan()]);
      setQueue(q.queue); setDesk(d); setOnLoan(l.loans);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);
  // Go back (top right) closes whichever view a button on this page opened.
  useBackStep(!!selectedGroup, () => setSelectedGroup(null));
  useBackStep(!!lendingGroup, () => setLendingGroup(null));
  useBackStep(showWalkin, () => setShowWalkin(false));

  if (loading) return <NavyShell><p /></NavyShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  const flash = {
    ok: (m: string) => { setNotice(m); setError(null); void load(); notifyBorrowBadgesChanged(); },
    err: (m: string) => { setError(m); setNotice(null); },
  };

  const enrollmentOf = (studentId: string) => desk?.pendingEnrollments[studentId] ?? null;
  const groups = queue ? groupItems(queue) : [];
  const shownPending = groups.filter((g) => matches(search, g.studentName, g.studentEmail, enrollmentOf(g.studentId)));
  const ready = desk?.ready ?? [];
  const shownReady = ready.filter((g) => matches(search, g.studentName, g.studentEmail, g.enrollmentNo));
  const loans = onLoan ?? [];
  const shownLoans = loans.filter((g) => matches(search, g.borrowerName, g.borrowerEmail ?? '', g.enrollmentNo ?? g.guestIdNumber));

  async function handleSubmitted(g: OnLoanGroup) {
    setSubmitting(g.key);
    try {
      const r = await markSubmitted(g.txnIds);
      setConfirmSubmit(null);
      flash.ok(`Marked as submitted for ${g.borrowerName} — recorded as ${OUTCOME_LABEL[r.outcome] ?? r.outcome} in Usage History.`);
    } catch (e) { flash.err(errMsg(e)); }
    finally { setSubmitting(null); }
  }

  // Keep selection in sync after reload
  const syncedGroup = selectedGroup
    ? groups.find((g) => g.groupId === selectedGroup.groupId) ?? null
    : null;

  // Lend view
  if (lendingGroup) {
    return (
      <NavyShell>
        <div style={wrap}>
          {error && <div style={box.err}>{error}</div>}
          <GroupLendForm
            target={lendingGroup}
            onBack={() => setLendingGroup(null)}
            onDone={(m) => { setLendingGroup(null); flash.ok(m); }}
            onError={flash.err}
          />
        </div>
      </NavyShell>
    );
  }

  return (
    <NavyShell>
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {syncedGroup ? (
          <GroupReviewPanel
            group={syncedGroup}
            enrollmentNo={enrollmentOf(syncedGroup.studentId)}
            onBack={() => setSelectedGroup(null)}
            onDone={(m) => { flash.ok(m); setSelectedGroup(null); }}
            onLend={(t) => { setSelectedGroup(null); setLendingGroup(t); }}
            onError={flash.err}
          />
        ) : (
          <>
            {/* Search — find the student standing at the desk with their card */}
            <div style={searchWrap} className="bq-searchbox">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input
                className="bq-search"
                style={searchInput}
                type="search"
                placeholder="Search student by name, email or enrollment no. (e.g. 02-134222-001)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search students"
              />
              {search && <button style={clearBtn} onClick={() => setSearch('')} aria-label="Clear search">×</button>}
            </div>

            <Panel title={`Approved — Ready to collect${ready.length ? ` (${ready.length})` : ''}`}>
              {desk === null ? (
                <p style={muted}>Loading…</p>
              ) : shownReady.length === 0 ? (
                <p style={muted}>{ready.length === 0 ? 'No approved requests waiting for collection.' : 'No approved request matches your search.'}</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Student</th>
                      <th style={th}>Items</th>
                      <th style={th}>Borrow window</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {shownReady.map((g) => (
                      <tr key={g.groupId}>
                        <td style={td}>
                          <span style={sName}>{g.studentName}</span>
                          <span style={sEmail}>{g.enrollmentNo ?? 'No enrollment no.'}{g.department ? ` · ${g.department}` : ''}</span>
                        </td>
                        <td style={td}>
                          {g.items.length > 1 && <span style={countBadge}>{g.items.length}</span>}
                          <span style={itemNames}>{g.items.map((i) => i.equipmentTypeName).join(', ')}</span>
                        </td>
                        <td style={td}>
                          {fmtDate(g.startAt)}{lendState(g.startAt, g.returnAt).today && <span style={todayTag}>Today</span>}<br />
                          <span style={{ color: '#6b7280', fontSize: 12 }}>{fmtTime(g.startAt)} – {fmtTime(g.returnAt)}</span>
                        </td>
                        <td style={{ ...td, textAlign: 'right', maxWidth: 230 }}>
                          <button
                            style={g.lendable ? lendBtn : { ...lendBtn, opacity: 0.45, cursor: 'not-allowed' }}
                            disabled={!g.lendable}
                            title={g.message ?? 'Check the university card and hand over the equipment'}
                            onClick={() => setLendingGroup(targetFromReady(g))}
                          >
                            Lend
                          </button>
                          {!g.lendable && g.message && <span style={lockNote}>{g.message}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title={`On loan — Awaiting submission${loans.length ? ` (${loans.length})` : ''}`}>
              {onLoan === null ? (
                <p style={muted}>Loading…</p>
              ) : shownLoans.length === 0 ? (
                <p style={muted}>{loans.length === 0 ? 'Nothing on loan right now.' : 'No loan matches your search.'}</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Student</th>
                      <th style={th}>Items</th>
                      <th style={th}>Borrow window</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {shownLoans.map((g) => {
                      const late = g.overdue;
                      const confirming = confirmSubmit === g.key;
                      const outcome = previewOutcome(g.returnAt);
                      const outcomeColor = outcome === 'COMPLETED_LATE' ? '#9A6412' : outcome === 'COMPLETED_EARLY' ? '#1D4ED8' : '#15803d';
                      return (
                        <tr key={g.key}>
                          <td style={td}>
                            <span style={sName}>{g.borrowerName}</span>
                            <span style={sEmail}>
                              {g.isGuest ? `Guest · ID ${g.guestIdNumber ?? '—'}` : (g.enrollmentNo ?? g.borrowerEmail ?? '')}
                              {!g.isGuest && g.department ? ` · ${g.department}` : ''}
                            </span>
                          </td>
                          <td style={td}>
                            {g.items.length > 1 && <span style={countBadge}>{g.items.length}</span>}
                            <span style={itemNames}>{g.items.map((i) => i.equipmentTypeName).join(', ')}</span>
                            {g.items.some((i) => i.barcodes) && (
                              <span style={{ display: 'block', color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                                {g.items.map((i) => i.barcodes).filter(Boolean).join(', ')}
                              </span>
                            )}
                          </td>
                          <td style={td}>
                            {fmtDate(g.startAt)}
                            {late ? <span style={lateTag}>Late</span> : <span style={todayTag}>On loan</span>}<br />
                            <span style={{ color: '#6b7280', fontSize: 12 }}>{fmtTime(g.startAt)} – {fmtTime(g.returnAt)}</span>
                          </td>
                          <td style={{ ...td, textAlign: 'right', maxWidth: 260 }}>
                            {!confirming ? (
                              <button style={submittedBtn} onClick={() => setConfirmSubmit(g.key)}
                                title="The student has handed the equipment back at the desk">
                                Submitted
                              </button>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                                <span style={{ fontSize: 12, color: outcomeColor, fontWeight: 600 }}>
                                  Will be recorded as {OUTCOME_LABEL[outcome]}
                                </span>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button style={submittedBtn} disabled={submitting === g.key} onClick={() => handleSubmitted(g)}>
                                    {submitting === g.key ? 'Saving…' : 'Confirm'}
                                  </button>
                                  <button style={cancelBtn} disabled={submitting === g.key} onClick={() => setConfirmSubmit(null)}>Cancel</button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title={`Pending Requests${groups.length ? ` (${groups.length})` : ''}`}>
              {queue === null ? (
                <p style={muted}>Loading…</p>
              ) : shownPending.length === 0 ? (
                <p style={muted}>{groups.length === 0 ? 'No pending requests.' : 'No pending request matches your search.'}</p>
              ) : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Student</th>
                      <th style={th}>Items</th>
                      <th style={th}>Borrow window</th>
                      <th style={th}>Submitted</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {shownPending.map((g) => {
                      const f = g.items[0]!;
                      const enr = enrollmentOf(g.studentId);
                      return (
                        <tr key={g.groupId}>
                          <td style={td}>
                            <span style={sName}>{g.studentName}</span>
                            <span style={sEmail}>{enr ?? g.studentEmail}</span>
                            {g.isBadSport && <span style={badSportBadge}>⚠ Late returner</span>}
                          </td>
                          <td style={td}>
                            {g.items.length > 1 && (
                              <span style={countBadge}>{g.items.length}</span>
                            )}
                            <span style={itemNames}>{g.items.map((i) => i.equipment_type_name).join(', ')}</span>
                          </td>
                          <td style={td}>
                            {fmtDate(f.requested_start_at)}
                            {lendState(f.requested_start_at, f.requested_return_at).today
                              ? <span style={todayTag}>Today</span>
                              : <span style={upcomingTag}>Upcoming</span>}<br />
                            <span style={{ color: '#6b7280', fontSize: 12 }}>{fmtTime(f.requested_start_at)} – {fmtTime(f.requested_return_at)}</span>
                          </td>
                          <td style={td}>
                            {fmtDate(g.submittedAt)}<br />
                            <span style={{ color: '#6b7280', fontSize: 12 }}>{fmtTime(g.submittedAt)}</span>
                          </td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <button style={reviewBtn} onClick={() => setSelectedGroup(g)}>Review →</button>
                          </td>
                        </tr>
                      );
                    })}
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
    </NavyShell>
  );
}

// ─── Group review panel ───────────────────────────────────────────────────────

function GroupReviewPanel({ group, enrollmentNo, onBack, onDone, onLend, onError }: {
  group: QueueGroup;
  enrollmentNo: string | null;
  onBack: () => void;
  onDone: (m: string) => void;
  onLend: (t: LendTarget) => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');

  const expired = group.items.some((i) => isExpired(i.requested_start_at));
  const first = group.items[0]!;
  const lend = lendState(first.requested_start_at, first.requested_return_at);

  async function handleApprove() {
    setBusy(true);
    try {
      await approveGroup(group.groupId);
      setDone(true);
      onDone(lend.ok
        ? `Approved request for ${group.studentName}. Use “Lend” under Ready to collect when they bring their university card.`
        : `Approved request for ${group.studentName}. It can be lent on ${fmtDate(first.requested_start_at)} when they bring their university card.`);
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
    <div style={lendBox}>
      <button style={backBtn} onClick={onBack}>← Back to queue</button>

      <div style={studentHeader}>
        <div>
          <h2 style={reviewTitle}>{group.studentName}</h2>
          <span style={reviewEmail}>{enrollmentNo ? `${enrollmentNo} · ` : ''}{group.studentEmail}</span>
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
          <>
            <div style={actionRow}>
              <button style={busy ? { ...approveBtn, opacity: 0.6 } : approveBtn} disabled={busy} onClick={handleApprove}>
                Approve
              </button>
              <button
                style={busy || !lend.ok ? { ...approveLendBtn, opacity: 0.45, cursor: 'not-allowed' } : approveLendBtn}
                disabled={busy || !lend.ok}
                title={lend.why ?? 'Student is here with their university card'}
                onClick={() => onLend(targetFromPending(group, enrollmentNo))}
              >
                Lend
              </button>
              <button style={rejectOutlineBtn} disabled={busy} onClick={() => setRejectOpen(true)}>
                Reject
              </button>
            </div>
            <p style={lockNote}>
              {lend.ok
                ? 'Lend only when the student is at the desk with their university card — you will check the enrollment number on the card next.'
                : lend.why}
            </p>
          </>
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
interface ArticlePairRow {
  pairId: string;
  articleAId: string;
  articleBId: string;
  barcodeA: string;
  barcodeB: string;
  condition: string;
}

function buildPairs(articles: Article[]): ArticlePairRow[] {
  const seen = new Set<string>();
  const pairs: ArticlePairRow[] = [];
  for (const a of articles) {
    if (!a.pair_id || !a.article_a_id || !a.article_b_id) continue;
    if (seen.has(a.pair_id)) continue;
    seen.add(a.pair_id);
    const partnerA = articles.find(x => x.article_id === a.article_a_id);
    const partnerB = articles.find(x => x.article_id === a.article_b_id);
    if (!partnerA || !partnerB) continue;
    pairs.push({
      pairId: a.pair_id,
      articleAId: a.article_a_id,
      articleBId: a.article_b_id,
      barcodeA: partnerA.barcode,
      barcodeB: partnerB.barcode,
      condition: partnerA.current_condition_label ?? 'GOOD',
    });
  }
  return pairs;
}

function GroupLendForm({ target, onBack, onDone, onError }: {
  target: LendTarget;
  onBack: () => void;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [typeArticles, setTypeArticles] = useState<TypeArticles[]>([]);
  const [cardNo, setCardNo] = useState('');
  const [idCardHeld, setIdCardHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const results = await Promise.all(
          target.items.map(async (item) => {
            const r = await listArticles({ equipmentTypeId: item.typeId, state: 'AVAILABLE' });
            return { ...item, articles: r.articles, selected: [] as string[] };
          }),
        );
        setTypeArticles(results);
      } catch (e) {
        setLoadError(errMsg(e));
      }
    }
    void load();
  }, [target]);

  function selectArticle(typeId: number, articleIds: string[]) {
    setTypeArticles((prev) =>
      prev.map((ta) => {
        if (ta.typeId !== typeId) return ta;
        const isSame = ta.selected.length === articleIds.length &&
          articleIds.every(id => ta.selected.includes(id));
        return { ...ta, selected: isSame ? [] : articleIds };
      }),
    );
  }

  // University card check: the number typed from the card must match the account.
  const typed = normalizeEnrollment(cardNo);
  const cardEntered = cardNo.trim().length > 0;
  const cardMatches = !!target.enrollmentNo && cardEntered && typed === target.enrollmentNo;
  const cardMismatch = cardEntered && typed.replace(/\D/g, '').length >= 11 && !cardMatches;

  // Every type must have ≥ 1 article selected
  const allSelected = typeArticles.length > 0 && typeArticles.every((ta) => ta.selected.length > 0);
  const canLend = allSelected && cardMatches && idCardHeld;

  async function handleLend() {
    if (!canLend) return;
    setBusy(true);
    try {
      const articlesPerType: Record<number, string[]> = {};
      for (const ta of typeArticles) {
        articlesPerType[ta.typeId] = ta.selected;
      }
      await lendWithCard(target.groupId, { idCardEnrollmentNo: typed, articlesPerType });
      onDone(`Equipment lent to ${target.studentName}. Return by ${fmtTime(target.returnAt)}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <div style={lendBox}>
      <button style={backBtn} onClick={onBack}>← Back</button>

      <div style={studentHeader}>
        <div>
          <h2 style={reviewTitle}>Lend to {target.studentName}</h2>
          <span style={reviewEmail}>{target.enrollmentNo ? `${target.enrollmentNo} · ` : ''}{target.studentEmail}</span>
        </div>
      </div>

      {/* Time window summary */}
      <div style={timeSummary}>
        <span style={detailLabel}>Window</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {fmtDate(target.startAt)} · {fmtTime(target.startAt)} – {fmtTime(target.returnAt)}
        </span>
      </div>

      {/* Step 1 — university card */}
      <div style={cardBox}>
        <label style={fieldLabel} htmlFor="card-enrollment">Enrollment no. on the student's university card</label>
        <input
          id="card-enrollment"
          style={{ ...fieldInput, marginTop: 6, borderColor: cardMatches ? '#16a34a' : cardMismatch ? '#dc2626' : '#d1d5db' }}
          placeholder="e.g. 02-134222-001"
          value={cardNo}
          autoComplete="off"
          onChange={(e) => setCardNo(e.target.value)}
        />
        {!target.enrollmentNo && (
          <p style={{ ...idCardWarning, color: '#b91c1c' }}>This student has no enrollment number on their profile, so the card can't be verified.</p>
        )}
        {cardMatches && <p style={selectionHint}>✓ Card matches {target.studentName}</p>}
        {cardMismatch && <p style={{ ...idCardWarning, color: '#b91c1c' }}>This card does not belong to {target.studentName}. Lend only to the student who made the request.</p>}
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
            ) : ta.lendingUnit === 'PAIR' ? (() => {
              const pairs = buildPairs(ta.articles);
              if (pairs.length === 0) return (
                <p style={{ ...muted, color: '#b91c1c', margin: 0 }}>No available pairs for this type.</p>
              );
              return (
                <div style={articleList}>
                  {pairs.map((p) => {
                    const isSelected = ta.selected.includes(p.articleAId) && ta.selected.includes(p.articleBId);
                    return (
                      <label key={p.pairId} style={articleRow}>
                        <input
                          type="radio"
                          name={`article-type-${ta.typeId}`}
                          checked={isSelected}
                          onChange={() => selectArticle(ta.typeId, [p.articleAId, p.articleBId])}
                        />
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{p.barcodeA} + {p.barcodeB}</span>
                        <span style={{ color: '#6b7280', fontSize: 12 }}>{p.condition}</span>
                      </label>
                    );
                  })}
                </div>
              );
            })() : (
              <div style={articleList}>
                {ta.articles.map((a) => (
                  <label key={a.article_id} style={articleRow}>
                    <input
                      type="radio"
                      name={`article-type-${ta.typeId}`}
                      checked={ta.selected[0] === a.article_id}
                      onChange={() => selectArticle(ta.typeId, [a.article_id])}
                    />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{a.barcode}</span>
                    <span style={{ color: '#6b7280', fontSize: 12 }}>{a.current_condition_label}</span>
                  </label>
                ))}
              </div>
            )}

            {ta.selected.length > 0 && (
              <p style={selectionHint}>
                ✓ {ta.lendingUnit === 'PAIR' ? 'Pair selected' : 'Article selected'}
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

      {allSelected && (!cardMatches || !idCardHeld) && (
        <p style={idCardWarning}>
          {!cardMatches ? 'Enter the enrollment number from the student\'s university card first.' : 'You must confirm the ID card is held before completing the lend.'}
        </p>
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
    <div style={walkinGrid} className="bq-walkin">
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
    <div style={walkinGrid} className="bq-walkin">
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

// ─── Navy page shell (same look as Active Borrows / Inventory / Messages) ─────

function NavyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bq-ui" style={shell.page}>
      <style>{`
        .bq-ui { font-family: 'Inter', system-ui, sans-serif; }
        .bq-ui * { box-sizing: border-box; }
        .bq-ui table tbody tr { transition: background-color .12s ease; }
        .bq-ui table tbody tr:hover { background: rgba(28,57,142,0.05); }
        .bq-ui button { font-family: inherit; }
        .bq-ui input:focus, .bq-ui select:focus { outline: none; box-shadow: 0 0 0 3px #DBEAFE; }
        .bq-ui input.bq-search, .bq-ui input.bq-search:focus { border: none !important; outline: none !important; box-shadow: none !important; background: transparent; -webkit-appearance: none; appearance: none; }
        .bq-ui input.bq-search::-webkit-search-cancel-button { display: none; }
        .bq-searchbox, .bq-searchbox:focus-within { outline: none !important; }
        .bq-ui input.bq-search:focus-visible { outline: none !important; box-shadow: none !important; }
        .bq-ui .bq-table-scroll { overflow-x: auto; }
        @media (max-width: 620px) {
          .bq-glass { padding: 20px 12px 24px !important; border-radius: 18px !important; }
          .bq-main { padding: 12px 10px 32px !important; }
          .bq-walkin { grid-template-columns: 1fr !important; }
          .bq-walkin > * { grid-column: auto !important; min-width: 0; }
          .bq-walkin input, .bq-walkin select { width: 100%; min-width: 0; }
        }
      `}</style>
      <div style={shell.blobA} aria-hidden />
      <div style={shell.blobB} aria-hidden />
      <HideInAppShell>
        <header style={shell.topbar}>
          <img src="/landing/bu_logo.png" alt="Bahria University" style={shell.logo} />
          <div>
            <div style={shell.wordmark}>Bahria University</div>
            <div style={shell.wordmarkSub}>Sports Management Portal</div>
          </div>
        </header>
      </HideInAppShell>
      <main className="bq-main" style={shell.main}>
        <div className="bq-glass" style={shell.glass}>
          <div style={shell.headRow}>
            <span style={shell.eyebrow}>Coordinator Portal</span>
            <h1 style={shell.title}>Borrow Queue</h1>
            <p style={shell.subtitle}>Approve requests, then lend on the requested day once the student shows their university card.</p>
          </div>
          {children}
        </div>
      </main>
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
      <div style={panelBody} className="bq-table-scroll">{children}</div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const NAVY = { n900: '#0F172B', n800: '#132357', accent: '#1C398E', s400: '#90A1B9', s300: '#CAD5E2', s100: '#E2E8F0', s50: '#F8FAFC' };
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';
const shell = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${NAVY.n800}aa 0%, transparent 60%), radial-gradient(900px 600px at 100% 100%, ${NAVY.accent}22 0%, transparent 55%), ${NAVY.n900}`,
  } as React.CSSProperties,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${NAVY.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as React.CSSProperties,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${NAVY.n800}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as React.CSSProperties,
  topbar: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '18px 32px' } as React.CSSProperties,
  logo: { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: NAVY.s50, padding: 4, border: `1px solid ${NAVY.s300}` } as React.CSSProperties,
  wordmark: { fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.2 } as React.CSSProperties,
  wordmarkSub: { fontSize: 12, color: NAVY.s400, marginTop: 1 } as React.CSSProperties,
  main: { position: 'relative', zIndex: 1, flex: 1, padding: '20px 24px 56px', width: '100%', maxWidth: 1040, margin: '0 auto' } as React.CSSProperties,
  glass: {
    position: 'relative', background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24, padding: '28px 24px 32px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as React.CSSProperties,
  headRow: { marginBottom: 20 } as React.CSSProperties,
  eyebrow: { display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', padding: '6px 14px', borderRadius: 999, marginBottom: 10, color: NAVY.s100, background: `${NAVY.n800}88`, border: `1px solid ${NAVY.s400}55` } as React.CSSProperties,
  title: { fontSize: 28, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.5px' } as React.CSSProperties,
  subtitle: { fontSize: 14, color: NAVY.s300, margin: '6px 0 0' } as React.CSSProperties,
};

const wrap: React.CSSProperties = { width: '100%', display: 'flex', flexDirection: 'column', gap: 18 };
const muted: React.CSSProperties = { color: '#6b7280', fontSize: 14, margin: 0 };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 6, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 6, padding: '10px 14px', fontSize: 14 } as React.CSSProperties,
};

const panelWrap: React.CSSProperties = { border: `1px solid ${NAVY.s300}e6`, borderRadius: 16, overflow: 'hidden', background: CARD_BG, boxShadow: CARD_SHADOW };
const panelHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: '#fff', borderBottom: `1px solid ${NAVY.s300}`, gap: 12 };
const panelTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#111' };
const panelBody: React.CSSProperties = { padding: '18px 20px' };

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

const reqCard: React.CSSProperties = { border: `1px solid ${NAVY.s300}`, borderRadius: 12, padding: '16px', background: '#fff' };
const detailGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px 16px', marginBottom: 16 };
const detailCell: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const detailLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' };
const detailValue: React.CSSProperties = { fontSize: 14, color: '#111', fontWeight: 500 };
const itemRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 7 };

const actionRow: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 };
const approveBtn: React.CSSProperties = { background: '#1F7A45', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const approveLendBtn: React.CSSProperties = { background: NAVY.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const rejectOutlineBtn: React.CSSProperties = { background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const confirmRejectBtn: React.CSSProperties = { background: '#6b7280', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const cancelBtn: React.CSSProperties = { background: 'transparent', color: '#6b7280', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px', fontSize: 13, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: 'transparent', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer' };
const reviewBtn: React.CSSProperties = { background: 'transparent', color: NAVY.accent, border: 'none', borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const rejectForm: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 };
const rejectInput: React.CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, width: '100%', boxSizing: 'border-box' };
const approvedTag: React.CSSProperties = { display: 'inline-block', background: '#d1fae5', color: '#065f46', fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 12 };
const expiredTag: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 7, background: '#f3f4f6', color: '#6b7280', fontSize: 13, fontWeight: 500, marginTop: 8 };

const backBtn: React.CSSProperties = { background: 'none', border: 'none', color: NAVY.accent, cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 20 };

// Lend form styles
const lendBox: React.CSSProperties = { border: `1px solid ${NAVY.s300}e6`, borderRadius: 16, padding: '22px', background: CARD_BG, boxShadow: CARD_SHADOW };
const timeSummary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, padding: '10px 14px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' };
const typeSection: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px', background: '#fafafa' };
const typeSectionHeader: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 };
const typeSectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#111' };
const typeSectionMeta: React.CSSProperties = { fontSize: 12, color: '#6b7280', background: '#e5e7eb', padding: '2px 8px', borderRadius: 10 };
const articleList: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const articleRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: 'pointer' };
const searchWrap: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: '#fff', border: `1px solid ${NAVY.s300}`, borderRadius: 12, boxShadow: CARD_SHADOW };
const searchInput: React.CSSProperties = { flex: 1, border: 'none', outline: 'none', padding: '12px 0', fontSize: 14, background: 'transparent', minWidth: 0 };
const clearBtn: React.CSSProperties = { border: 'none', background: '#f3f4f6', color: '#374151', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', fontSize: 16, lineHeight: 1 };
const todayTag: React.CSSProperties = { display: 'inline-block', marginLeft: 6, background: '#dcfce7', color: '#15803d', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 };
const upcomingTag: React.CSSProperties = { display: 'inline-block', marginLeft: 6, background: '#e0e7ff', color: '#3730a3', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 };
const lendBtn: React.CSSProperties = { background: NAVY.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const lockNote: React.CSSProperties = { display: 'block', margin: '6px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.4 };
const cardBox: React.CSSProperties = { marginTop: 14, padding: '14px 16px', borderRadius: 8, border: '1px solid #bfdbfe', background: '#eff6ff', display: 'flex', flexDirection: 'column' };
const selectionHint: React.CSSProperties = { margin: '8px 0 0', fontSize: 12, color: '#065f46', fontWeight: 600 };
const idCardLabel: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 20, padding: '14px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 14, cursor: 'pointer' };
const idCardWarning: React.CSSProperties = { margin: '8px 0 0', fontSize: 13, color: '#92400e', fontWeight: 500 };
const confirmLendBtn: React.CSSProperties = { background: NAVY.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer', width: '100%' };

// Walk-in
const walkinGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' };
const formField: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151' };
const fieldInput: React.CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 };
const tabBar: React.CSSProperties = { display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #e5e7eb' };
const activeTab: React.CSSProperties = { background: 'none', border: 'none', borderBottom: '2px solid #1d4ed8', color: NAVY.accent, fontWeight: 700, fontSize: 13, padding: '8px 18px', cursor: 'pointer', marginBottom: -1 };
const inactiveTab: React.CSSProperties = { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#6b7280', fontWeight: 500, fontSize: 13, padding: '8px 18px', cursor: 'pointer', marginBottom: -1 };
const resolveBtn: React.CSSProperties = { background: NAVY.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
const resolvedCard: React.CSSProperties = { marginTop: 8, padding: '10px 14px', borderRadius: 7, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', flexDirection: 'column', gap: 2 };
const resolvedName: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#065f46' };
const resolvedDetail: React.CSSProperties = { fontSize: 12, color: '#047857' };
const submittedBtn: React.CSSProperties = { background: '#1F7A45', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' };
const lateTag: React.CSSProperties = { display: 'inline-block', marginLeft: 6, background: '#FDF1E3', color: '#9A6412', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 };
