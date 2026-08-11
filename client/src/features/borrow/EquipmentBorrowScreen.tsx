/**
 * Equipment Borrow Detail Screen — /borrow/:typeId
 *
 * Shows the equipment image, name, sport, availability, lending rules,
 * the borrow request form, and a "Frequently bought together" section
 * showing other equipment types in the same sport. Student can tick any
 * related items to include them in the same borrow request batch.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell, PrimaryButton } from '../auth/PortalShell.js';
import { listAvailability, type AvailabilityRow } from '../availability/api.js';
import { submitRequest } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown): string {
  if (e instanceof ApiRequestError) return e.body?.error ?? e.message ?? 'Something went wrong.';
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

// ── Time helpers ──────────────────────────────────────────────────────────────
const OPEN_HH = 8;
const CLOSE_HH = 17;
function toHHMM(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function smartStart() { const now = new Date(); return toHHMM(Math.min(Math.max(Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5, OPEN_HH * 60), CLOSE_HH * 60 - 5)); }
function smartEnd(start: string, maxMin: number) { const p = start.split(':').map(Number); return toHHMM(Math.min((p[0] ?? 8) * 60 + (p[1] ?? 0) + maxMin, CLOSE_HH * 60)); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function nowMinTime(date: string) { const today = todayStr(); if (date !== today) return `${OPEN_HH.toString().padStart(2, '0')}:00`; const now = new Date(); return toHHMM(Math.max(now.getHours() * 60 + now.getMinutes(), OPEN_HH * 60)); }

export default function EquipmentBorrowScreen() {
  const { user, loading } = useAuth();
  const { typeId } = useParams<{ typeId: string }>();
  const navigate = useNavigate();

  // Main item
  const [row, setRow] = useState<AvailabilityRow | null>(null);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Related items (same sport, excluding self)
  const [related, setRelated] = useState<AvailabilityRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Form
  const [date, setDate] = useState(todayStr);
  const [startTime, setStartTime] = useState(smartStart);
  const [endTime, setEndTime] = useState(() => smartEnd(smartStart(), 480));
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Load main item
  useEffect(() => {
    if (!typeId) return;
    setFetching(true);
    setRow(null);
    setRelated([]);
    setSelected(new Set());

    listAvailability({ equipmentTypeId: Number(typeId) })
      .then((res) => {
        const main = res.status[0] ?? null;
        setRow(main);
        if (!main) { setFetchError('Equipment not found.'); return; }

        // Load siblings in the same sport category
        return listAvailability({ sportCategoryId: main.sportCategoryId })
          .then((r) => {
            setRelated(r.status.filter((s) => s.equipmentTypeId !== main.equipmentTypeId));
          });
      })
      .catch(() => setFetchError('Could not load equipment details.'))
      .finally(() => setFetching(false));
  }, [typeId]);

  if (loading) return <PortalShell title="Request to Borrow"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT') return <Navigate to="/home" replace />;

  function toggleRelated(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setSubmitting(true);
    setFormError(null);

    const requestedStartAt = `${date}T${startTime}:00.000Z`;
    const requestedReturnAt = `${date}T${endTime}:00.000Z`;

    // Submit main item + any ticked related items sequentially
    const typeIds = [row.equipmentTypeId, ...Array.from(selected)];
    const itemErrors: { name: string; reason: string }[] = [];

    for (const id of typeIds) {
      const name = id === row.equipmentTypeId
        ? row.name
        : (related.find((r) => r.equipmentTypeId === id)?.name ?? String(id));
      try {
        await submitRequest({ equipmentTypeId: id, requestedStartAt, requestedReturnAt });
      } catch (err) {
        itemErrors.push({ name, reason: errMsg(err) });
      }
    }

    setSubmitting(false);

    const succeeded = typeIds.length - itemErrors.length;

    if (itemErrors.length === 0) {
      // All succeeded
      const extras = typeIds.length - 1;
      setNotice(
        extras > 0
          ? `Request submitted for ${row.name} + ${extras} related item${extras > 1 ? 's' : ''}! A Coordinator will review your requests.`
          : 'Request submitted! A Coordinator will review it shortly.',
      );
    } else if (succeeded > 0) {
      // Some succeeded, some failed — show which failed and why
      const reasons = itemErrors.map((err) => `${err.name}: ${err.reason}`).join(' · ');
      setNotice(`Partially submitted (${succeeded} of ${typeIds.length} items). Issues — ${reasons}`);
    } else {
      // Everything failed — show the first error directly (usually the main item)
      setFormError(itemErrors[0]?.reason ?? 'Request failed. Please try again.');
    }
  }

  const badgeStyle: React.CSSProperties = !row ? {} :
    row.statusBadge === 'AVAILABLE' ? { background: '#d1fae5', color: '#065f46' } :
      row.statusBadge === 'LOW_STOCK' ? { background: '#fef3c7', color: '#92400e' } :
        { background: '#fee2e2', color: '#991b1b' }; 
  const badgeText = !row ? '' :
    row.statusBadge === 'AVAILABLE' ? 'Available' :
      row.statusBadge === 'LOW_STOCK' ? 'Low Stock' : 'Checked Out';

  return (
    <PortalShell title="Request to Borrow" tint="sage">
      <div style={wrap}>
        <button style={backBtn} onClick={() => navigate(-1)}>← Back</button>

        {fetching && <p style={muted}>Loading…</p>}
        {fetchError && <div style={box.err}>{fetchError}</div>}

        {row && (
          <>
            {/* ── Main two-column layout ── */}
            <div style={layout}>
              {/* Left: equipment detail */}
              <div style={detailCard}>
                <div style={imageWrap}>
                  {row.imageUrl ? (
                    <img
                      src={row.imageUrl}
                      alt={row.name}
                      style={image}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div style={imagePlaceholder}>
                      <span style={placeholderLetter}>{row.name.charAt(0)}</span>
                    </div>
                  )}
                </div>

                <div style={infoBody}>
                  <div style={nameRow}>
                    <h1 style={equipName}>{row.name}</h1>
                    <span style={{ ...badge, ...badgeStyle }}>{badgeText}</span>
                  </div>
                  <p style={sportTag}>{row.sportCategoryName} · {row.isIndoor ? 'Indoor' : 'Outdoor'}</p>

                  <div style={statsGrid}>
                    <div style={statCell}>
                      <span style={statLabel}>Available now</span>
                      <span style={statValue}>{row.availableUnits}</span>
                    </div>
                    <div style={statCell}>
                      <span style={statLabel}>Lending unit</span>
                      <span style={statValue}>{row.lendingUnit === 'PAIR' ? 'Pair' : 'Single'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: borrow form */}
              <div style={formCard}>
                <h2 style={formTitle}>Submit a Request</h2>
                <p style={formSubtitle}>A Coordinator will review and approve before you collect.</p>

                {notice && <div style={box.ok}>{notice}</div>}
                {formError && <div style={box.err}>{formError}</div>}

                {!notice && (
                  <form onSubmit={handleSubmit} style={formGrid}>
                    <div style={field}>
                      <label style={fieldLabel}>Date</label>
                      <input type="date" style={inp} value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)} required />
                    </div>
                    <div style={field}>
                      <label style={fieldLabel}>Start time</label>
                      <input type="time" style={inp} value={startTime} min={nowMinTime(date)} max="17:00" step={300}
                        onChange={(e) => { setStartTime(e.target.value); setEndTime(smartEnd(e.target.value, 480)); }} required />
                    </div>
                    <div style={field}>
                      <label style={fieldLabel}>Return by</label>
                      <input type="time" style={inp} value={endTime} min={startTime} max="17:00" step={300}
                        onChange={(e) => setEndTime(e.target.value)} required />
                    </div>

                    {/* Summary of selected extras */}
                    {selected.size > 0 && (
                      <div style={{ gridColumn: '1 / -1', ...summaryBox }}>
                        <span style={summaryLabel}>Requesting:</span>
                        <span style={summaryItems}>
                          {[row.name, ...Array.from(selected).map(
                            (id) => related.find((r) => r.equipmentTypeId === id)?.name ?? ''
                          )].filter(Boolean).join(' + ')}
                        </span>
                      </div>
                    )}

                    <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
                      <PrimaryButton disabled={submitting || row.availableUnits === 0}>
                        {row.availableUnits === 0
                          ? 'Unavailable — cannot request'
                          : submitting
                            ? 'Submitting…'
                            : selected.size > 0
                              ? `Submit Request (${1 + selected.size} items)`
                              : 'Submit Request'}
                      </PrimaryButton>
                    </div>

                    {row.availableUnits === 0 && (
                      <p style={{ ...muted, gridColumn: '1 / -1', marginTop: 0 }}>
                        All units are currently checked out. Check back later.
                      </p>
                    )}
                  </form>
                )}

                <div style={rulesBox}>
                  <p style={rulesTitle}>Before you request</p>
                  <ul style={rulesList}>
                    <li>Borrow window must start and end on the same day.</li>
                    <li>Bring your student ID card when collecting.</li>
                    <li>Return equipment in the same condition.</li>
                    {row.lendingUnit === 'PAIR' && (
                      <li>Lent as a pair — both pieces must be returned together.</li>
                    )}
                  </ul>
                </div>

                {notice && (
                  <div style={successActions}>
                    <button style={viewRequestsBtn} onClick={() => navigate('/my-borrows')}>
                      View My Requests
                    </button>
                    <button style={backLink} onClick={() => navigate(-1)}>
                      ← Back to Availability
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Frequently bought together ── */}
            {related.length > 0 && !notice && (
              <div style={relatedSection}>
                <div style={relatedHeader}>
                  <h2 style={relatedTitle}>Frequently borrowed together</h2>
                  <p style={relatedSubtitle}>
                    Other {row.sportCategoryName} equipment — tick to include in this request.
                  </p>
                </div>

                <div style={relatedGrid}>
                  {related.map((item) => {
                    const ticked = selected.has(item.equipmentTypeId);
                    const unavailable = item.availableUnits === 0;

                    const itemBadge: React.CSSProperties =
                      item.statusBadge === 'AVAILABLE' ? { background: '#d1fae5', color: '#065f46' } :
                        item.statusBadge === 'LOW_STOCK' ? { background: '#fef3c7', color: '#92400e' } :
                          { background: '#fee2e2', color: '#991b1b' };
                    const itemBadgeText =
                      item.statusBadge === 'AVAILABLE' ? 'Available' :
                        item.statusBadge === 'LOW_STOCK' ? 'Low Stock' : 'Checked Out';

                    return (
                      <div
                        key={item.equipmentTypeId}
                        style={{
                          ...relatedCard,
                          ...(ticked ? relatedCardTicked : {}),
                          ...(unavailable ? relatedCardUnavailable : {}),
                        }}
                        onClick={() => !unavailable && toggleRelated(item.equipmentTypeId)}
                      >
                        {/* Checkbox */}
                        <div style={checkboxWrap}>
                          <div style={{ ...checkbox, ...(ticked ? checkboxTicked : {}) }}>
                            {ticked && <span style={checkmark}>✓</span>}
                          </div>
                        </div>

                        {/* Thumbnail */}
                        <div style={relatedThumb}>
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              style={relatedThumbImg}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          ) : (
                            <div style={relatedThumbPlaceholder}>{item.name.charAt(0)}</div>
                          )}
                        </div>

                        {/* Info */}
                        <div style={relatedInfo}>
                          <span style={relatedName}>{item.name}</span>
                          <div style={relatedMeta}>
                            <span style={{ ...relatedBadge, ...itemBadge }}>{itemBadgeText}</span>
                            <span style={relatedAvail}>{item.availableUnits} available</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selected.size > 0 && (
                  <p style={relatedHint}>
                    ✓ {selected.size} item{selected.size > 1 ? 's' : ''} added — same borrow window will apply to all.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = { maxWidth: 960, margin: '0 auto', padding: '24px 16px' };
const muted: React.CSSProperties = { color: '#6b7280', fontSize: 14, margin: 0 };
const backBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 20 };

const box = {
  err: { padding: '10px 14px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 14, marginBottom: 14 } as React.CSSProperties,
  ok: { padding: '10px 14px', borderRadius: 8, background: '#d1fae5', color: '#065f46', fontSize: 14, marginBottom: 14 } as React.CSSProperties,
};

const layout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: 24,
  alignItems: 'start',
};

// Detail card
const detailCard: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff' };
const imageWrap: React.CSSProperties = { background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const image: React.CSSProperties = { width: '100%', height: 230, objectFit: 'contain' };
const imagePlaceholder: React.CSSProperties = { width: 90, height: 90, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const placeholderLetter: React.CSSProperties = { fontSize: 40, fontWeight: 700, color: '#fff' };
const infoBody: React.CSSProperties = { padding: '20px 22px' };
const nameRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 };
const equipName: React.CSSProperties = { margin: 0, fontSize: 22, fontWeight: 700, color: '#111', flex: 1 };
const badge: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 };
const sportTag: React.CSSProperties = { margin: '0 0 16px', fontSize: 13, color: '#6b7280' };
const statsGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 };
const statCell: React.CSSProperties = { background: '#f9fafb', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 };
const statLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' };
const statValue: React.CSSProperties = { fontSize: 20, fontWeight: 700, color: '#111' };
const rulesBox: React.CSSProperties = { background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '14px 16px', marginTop: 20 };
const rulesTitle: React.CSSProperties = { margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: '#374151' };
const rulesList: React.CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 13, color: '#4b5563', lineHeight: 1.7 };

// Form card
const formCard: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: '24px', background: '#fff' };
const formTitle: React.CSSProperties = { margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: '#111' };
const formSubtitle: React.CSSProperties = { margin: '0 0 20px', fontSize: 13, color: '#6b7280' };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151' };
const inp: React.CSSProperties = { padding: '9px 10px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 14 };

const summaryBox: React.CSSProperties = { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 7, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
const summaryLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#1e40af' };
const summaryItems: React.CSSProperties = { fontSize: 13, color: '#1e3a8a' };

const successActions: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 };
const viewRequestsBtn: React.CSSProperties = { padding: '10px 0', borderRadius: 8, border: 'none', background: '#374151', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const backLink: React.CSSProperties = { background: 'none', border: 'none', color: '#2563eb', fontSize: 14, cursor: 'pointer', padding: 0 };

// Frequently bought together section
const relatedSection: React.CSSProperties = { marginTop: 32 };
const relatedHeader: React.CSSProperties = { marginBottom: 16 };
const relatedTitle: React.CSSProperties = { margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: '#111' };
const relatedSubtitle: React.CSSProperties = { margin: 0, fontSize: 13, color: '#6b7280' };
const relatedGrid: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };

const relatedCard: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14,
  border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px',
  background: '#fff', cursor: 'pointer', transition: 'border-color 0.15s',
};
const relatedCardTicked: React.CSSProperties = {
  border: '2px solid #374151', background: '#f9fafb',
};
const relatedCardUnavailable: React.CSSProperties = {
  opacity: 0.5, cursor: 'not-allowed',
};

const checkboxWrap: React.CSSProperties = { flexShrink: 0 };
const checkbox: React.CSSProperties = {
  width: 20, height: 20, borderRadius: 5,
  border: '2px solid #d1d5db', background: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};
const checkboxTicked: React.CSSProperties = { background: '#374151', border: '2px solid #374151' };
const checkmark: React.CSSProperties = { color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1 };

const relatedThumb: React.CSSProperties = { width: 52, height: 52, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#f3f4f6' };
const relatedThumbImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' };
const relatedThumbPlaceholder: React.CSSProperties = { width: 52, height: 52, background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#6b7280' };

const relatedInfo: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 };
const relatedName: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: '#111' };
const relatedMeta: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const relatedBadge: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 };
const relatedAvail: React.CSSProperties = { fontSize: 12, color: '#6b7280' };
const relatedHint: React.CSSProperties = { marginTop: 12, fontSize: 13, color: '#374151', fontWeight: 500 };
