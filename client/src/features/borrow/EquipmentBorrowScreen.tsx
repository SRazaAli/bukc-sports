/**
 * Equipment Borrow Detail Screen — /borrow/:typeId
 *
 * Shows the equipment image, name, sport, availability, lending rules,
 * the borrow request form, and a "Frequently bought together" section
 * showing other equipment types in the same sport. Student can tick any
 * related items to include them in the same borrow request batch.
 *
 * Re-themed to match the site's actual current visual language (Landing /
 * Home / Register / Profile / Usage History / Accounts / Offline Fallback /
 * Conflict Detection / Venue Calendar / Equipment Availability): dark navy
 * page, the same header (logo, wordmark, ghost Back/Sign out) as Accounts,
 * everything wrapped in one frosted glass panel, white soft-gradient cards,
 * and a single accent blue for interactive elements. No borrow logic,
 * validation, or API calls were touched — only the wrapper and styling.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { listAvailability, type AvailabilityRow } from '../availability/api.js';
import { submitRequest } from './api.js';
import { ApiRequestError } from '../../lib/api.js';
import { api } from '../../lib/api.js';

/* ---------- theme (identical values used across the app) ---------- */
const palette = {
  navy900: '#0F172B',
  navy800: '#132357',
  navyDeep: '#031636',
  slate600: '#132357',
  slate500: '#62748E',
  slate400: '#90A1B9',
  slate300: '#CAD5E2',
  slate100: '#E2E8F0',
  slate50: '#F8FAFC',
  white: '#FFFFFF',
  accent: '#1C398E',
  accentSoft: '#DBEAFE',
  accentWash: '#1C398E14',
};

// Kit submit: POST /api/borrow/requests/kit
function submitKitRequest(input: { sportCategoryId: number; requestedStartAt: string; requestedReturnAt: string }) {
  return api<{ message: string; requestIds: string[] }>('/api/borrow/requests/kit', { method: 'POST', body: input });
}

function errMsg(e: unknown): string {
  if (e instanceof ApiRequestError) return e.body?.error ?? e.message ?? 'Something went wrong.';
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

// ── Time helpers ──────────────────────────────────────────────────────────────
const OPEN_HH = 8;
const CLOSE_HH = 17;
function toHHMM(m: number) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function smartStart() {
  const now = new Date();
  const mins = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  return toHHMM(Math.min(Math.max(mins, OPEN_HH * 60), CLOSE_HH * 60 - 5));
}
function smartEnd(start: string, maxMin: number) {
  const p = start.split(':').map(Number);
  return toHHMM(Math.min((p[0] ?? 8) * 60 + (p[1] ?? 0) + maxMin, CLOSE_HH * 60));
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function nowMinTime(date: string) {
  const today = todayStr();
  if (date !== today) return `${String(OPEN_HH).padStart(2, '0')}:00`;
  const now = new Date();
  const snapped = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  return toHHMM(Math.max(snapped, OPEN_HH * 60));
}

export default function EquipmentBorrowScreen() {
  const { user, loading, logout } = useAuth();
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

  if (loading) return <div className="ebw-ui" style={{ minHeight: '100%', background: palette.navy900 }} />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'STUDENT') return <Navigate to="/home" replace />;

  function toggleRelated(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Effective max duration = minimum across main item + all selected related items
  const effectiveMaxMinutes = (() => {
    const mins = [row?.maxBorrowDurationMinutes ?? 480];
    for (const id of selected) {
      const rel = related.find((r) => r.equipmentTypeId === id);
      if (rel?.maxBorrowDurationMinutes) mins.push(rel.maxBorrowDurationMinutes);
    }
    return Math.min(...mins);
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setSubmitting(true);
    setFormError(null);

    // Build ISO timestamps treating the user's selected date+time as local time
    const toISO = (d: string, t: string) => {
      const dt = new Date(`${d}T${t}`);
      return dt.toISOString();
    };
    const requestedStartAt = toISO(date, startTime);
    const requestedReturnAt = toISO(date, endTime);

    // Validate duration client-side before hitting the server
    const durationMin = (new Date(requestedReturnAt).getTime() - new Date(requestedStartAt).getTime()) / 60_000;
    if (durationMin > effectiveMaxMinutes) {
      const h = Math.floor(effectiveMaxMinutes / 60);
      const m = effectiveMaxMinutes % 60;
      const dur = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
      setFormError(`Maximum borrow duration for this selection is ${dur}.`);
      setSubmitting(false);
      return;
    }

    // Submit all items as ONE logical group:
    // First item determines the group UUID; subsequent items pass that UUID in.
    const typeIds = [row.equipmentTypeId, ...Array.from(selected)];
    const itemErrors: { name: string; reason: string }[] = [];
    let groupId: string | undefined;

    for (const id of typeIds) {
      const name = id === row.equipmentTypeId
        ? row.name
        : (related.find((r) => r.equipmentTypeId === id)?.name ?? String(id));
      try {
        const res = await submitRequest({
          equipmentTypeId: id,
          requestedStartAt,
          requestedReturnAt,
          requestGroupId: groupId,
        });
        // First successful response establishes the group for all subsequent items
        if (!groupId) groupId = res.request.requestGroupId;
      } catch (err) {
        itemErrors.push({ name, reason: errMsg(err) });
      }
    }

    setSubmitting(false);

    if (itemErrors.length === 0) {
      const extras = typeIds.length - 1;
      setNotice(
        extras > 0
          ? `Request submitted for ${row.name} + ${extras} related item${extras > 1 ? 's' : ''}. A Coordinator will review it shortly.`
          : 'Request submitted! A Coordinator will review it shortly.',
      );
    } else if (typeIds.length - itemErrors.length > 0) {
      const reasons = itemErrors.map((err) => `${err.name}: ${err.reason}`).join(' · ');
      setNotice(`Partially submitted. Issues — ${reasons}`);
    } else {
      setFormError(itemErrors[0]?.reason ?? 'Request failed. Please try again.');
    }
  }

  const badgeStyle: React.CSSProperties = !row ? {} :
    row.statusBadge === 'AVAILABLE' ? { background: '#E6F4EC', color: '#1F7A45' } :
      row.statusBadge === 'LOW_STOCK' ? { background: '#FDF1E3', color: '#9A6412' } :
        { background: '#FDECEC', color: '#8F2323' };
  const badgeText = !row ? '' :
    row.statusBadge === 'AVAILABLE' ? 'Available' :
      row.statusBadge === 'LOW_STOCK' ? 'Low Stock' : 'Checked Out';

  return (
    <div className="ebw-ui" style={s.page}>
      <EbwStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />
      <div style={s.blobC} aria-hidden />

      <header style={s.topbar}>
        <div style={s.brand}>
          <img src="/landing/bu_logo.png" alt="Bahria University" style={s.logoImg} />
          <div>
            <div style={s.wordmark}>Bahria University</div>
            <div style={s.wordmarkSub}>Sports Management Portal</div>
          </div>
        </div>
        <div style={s.topbarRight}>
          <button type="button" className="hist-topbtn" style={s.topBtn} onClick={() => navigate(-1)}><BackIcon /> Back</button>
          <button type="button" className="hist-topbtn hist-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
            <SignOutIcon /> Sign out
          </button>
        </div>
      </header>

      <main style={s.main}>
        <div className="ebw-glass" style={s.glassPanel}>
          <div style={s.headRow}>
            <span style={s.accentBar} />
            <span style={s.eyebrow}>Student Portal</span>
            <h1 style={s.title}>Request to Borrow</h1>
            <p style={s.subtitle}>Check an item's details and submit a request to borrow it.</p>
          </div>

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
                    <span style={{ ...imageBadge, ...badgeStyle }}><DotIcon /> {badgeText}</span>
                  </div>

                  <div style={infoBody}>
                    <h1 style={equipName}>{row.name}</h1>
                    <p style={sportTag}><TagIcon /> {row.sportCategoryName} · {row.isIndoor ? 'Indoor' : 'Outdoor'}</p>

                    <div style={statsGrid}>
                      <div style={statCell}>
                        <span style={statIconBox}><BoxIcon /></span>
                        <span style={statTextCol}>
                          <span style={statLabel}>Available Stock</span>
                          <span style={statValue}>{row.availableUnits}</span>
                        </span>
                      </div>
                      <div style={statCell}>
                        <span style={statIconBox}><LayersIcon /></span>
                        <span style={statTextCol}>
                          <span style={statLabel}>Lending Unit</span>
                          <span style={statValue}>{row.lendingUnit === 'PAIR' ? 'Pair' : 'Single'}</span>
                        </span>
                      </div>
                    </div>

                    <div style={metaGrid}>
                      <div style={metaItem}>
                        <span style={metaIconBox}><TagIcon /></span>
                        <span style={metaTextCol}>
                          <span style={metaLabel}>Game Type</span>
                          <span style={metaValue}>{row.sportCategoryName}</span>
                        </span>
                      </div>
                      <div style={metaItem}>
                        <span style={metaIconBox}>{row.isIndoor ? <HomeIcon /> : <SunIcon />}</span>
                        <span style={metaTextCol}>
                          <span style={metaLabel}>Environment</span>
                          <span style={metaValue}>{row.isIndoor ? 'Indoor' : 'Outdoor'}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: borrow form */}
                <div style={formCard}>
                  <div style={formHeadRow}>
                    <span style={formHeadIcon}><SubmitIcon /></span>
                    <div>
                      <h2 style={formTitle}>Submit a Request</h2>
                      <p style={formSubtitle}>A Coordinator will review and approve before you collect.</p>
                    </div>
                  </div>

                  {notice && <div style={box.ok}>{notice}</div>}
                  {formError && <div style={box.err}>{formError}</div>}

                  {!notice && (
                    <form onSubmit={handleSubmit} style={formGrid}>
                      <div style={{ ...field, gridColumn: '1 / -1' }}>
                        <label style={fieldLabel}>Date</label>
                        <input className="ebw-input" type="date" style={inp} value={date} min={todayStr()} onChange={(e) => {
                          const newDate = e.target.value;
                          setDate(newDate);
                          const newStart = nowMinTime(newDate);
                          setStartTime(newStart);
                          setEndTime(smartEnd(newStart, effectiveMaxMinutes));
                        }} required />
                      </div>
                      <div style={field}>
                        <label style={fieldLabel}>Start time</label>
                        <input className="ebw-input" type="time" style={inp} value={startTime} min={nowMinTime(date)} max="17:00" step={300}
                          onChange={(e) => { setStartTime(e.target.value); setEndTime(smartEnd(e.target.value, effectiveMaxMinutes)); }} required />
                      </div>
                      <div style={field}>
                        <label style={fieldLabel}>Return by</label>
                        <input className="ebw-input" type="time" style={inp} value={endTime} min={startTime} max={smartEnd(startTime, effectiveMaxMinutes)} step={300}
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
                        <button type="submit" className="ebw-btn-primary" style={{ ...primaryBtn, ...((submitting || row.availableUnits === 0) ? primaryBtnDisabled : {}) }} disabled={submitting || row.availableUnits === 0}>
                          <SendIcon />
                          {row.availableUnits === 0
                            ? 'Unavailable — cannot request'
                            : submitting
                              ? 'Submitting…'
                              : selected.size > 0
                                ? `Submit Request (${1 + selected.size} items)`
                                : 'Submit Request'}
                        </button>
                      </div>

                      {row.availableUnits === 0 && (
                        <p style={{ ...muted, color: palette.slate500, gridColumn: '1 / -1', marginTop: 0 }}>
                          All units are currently checked out. Check back later.
                        </p>
                      )}
                    </form>
                  )}

                  <div style={rulesBox}>
                    <p style={rulesTitle}><InfoIcon /> Before you request</p>
                    <ul style={rulesList}>
                      <li><CheckMiniIcon /> Borrow window must start and end on the same day.</li>
                      <li><CheckMiniIcon /> Bring your student ID card when collecting.</li>
                      <li><CheckMiniIcon /> Return equipment in the same condition.</li>
                      {row.lendingUnit === 'PAIR' && (
                        <li><CheckMiniIcon /> Lent as a pair — both pieces must be returned together.</li>
                      )}
                    </ul>
                  </div>

                  {notice && (
                    <div style={successActions}>
                      <button className="ebw-btn-primary" style={viewRequestsBtn} onClick={() => navigate('/my-borrows')}>
                        View My Requests
                      </button>
                      <button className="ebw-link" style={backLink} onClick={() => navigate(-1)}>
                        ← Back to Availability
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Frequently bought together ── */}
              {related.length > 0 && !notice && (
                <div style={relatedSection}>
                  <div style={relatedHeaderRow}>
                    <span style={relatedHeaderIcon}><LinkIcon /></span>
                    <div>
                      <h2 style={relatedTitle}>Frequently borrowed together</h2>
                      <p style={relatedSubtitle}>
                        Other {row.sportCategoryName} equipment — tick to include in this request.
                      </p>
                    </div>
                  </div>

                  <div style={relatedGrid}>
                    {related.map((item) => {
                      const ticked = selected.has(item.equipmentTypeId);
                      const unavailable = item.availableUnits === 0;

                      const itemBadge: React.CSSProperties =
                        item.statusBadge === 'AVAILABLE' ? { background: '#E6F4EC', color: '#1F7A45' } :
                          item.statusBadge === 'LOW_STOCK' ? { background: '#FDF1E3', color: '#9A6412' } :
                            { background: '#FDECEC', color: '#8F2323' };
                      const itemBadgeText =
                        item.statusBadge === 'AVAILABLE' ? 'Available' :
                          item.statusBadge === 'LOW_STOCK' ? 'Low Stock' : 'Checked Out';

                      return (
                        <div
                          key={item.equipmentTypeId}
                          className="ebw-related-card"
                          style={{
                            ...relatedCard,
                            ...(ticked ? relatedCardTicked : {}),
                            ...(unavailable ? relatedCardUnavailable : {}),
                          }}
                          onClick={() => !unavailable && toggleRelated(item.equipmentTypeId)}
                        >
                          {/* Thumbnail with checkbox overlay */}
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
                            <div style={{ ...checkbox, ...(ticked ? checkboxTicked : {}) }}>
                              {ticked && <span style={checkmark}>✓</span>}
                            </div>
                          </div>

                          {/* Info */}
                          <div style={relatedInfo}>
                            <div style={relatedNameRow}>
                              <span style={relatedName}>{item.name}</span>
                              <span style={{ ...relatedBadge, ...itemBadge }}>{itemBadgeText}</span>
                            </div>
                            <span style={relatedEnvTag}>
                              {item.isIndoor ? <HomeIcon /> : <SunIcon />} {item.isIndoor ? 'Indoor' : 'Outdoor'}
                            </span>
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
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
      </footer>
    </div>
  );
}

function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function DotIcon() { return <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><circle cx="4" cy="4" r="4"/></svg>; }
function TagIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M9 2H4a1 1 0 0 0-1 1v5l7 7 6-6-7-7Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><circle cx="6" cy="6" r="1" fill="currentColor"/></svg>; }
function BoxIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 5.5 8 2l6 3.5v5L8 14 2 10.5v-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M2 5.5 8 9l6-3.5M8 9v5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>; }
function LayersIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="m8 1.5 6.5 3.5L8 8.5 1.5 5 8 1.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="m1.5 8 6.5 3.5L14.5 8M1.5 11l6.5 3.5L14.5 11" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>; }
function HomeIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 7.5 8 2l6 5.5V13a1 1 0 0 1-1 1h-3v-4H6v4H3a1 1 0 0 1-1-1V7.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>; }
function SunIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1v1.4M8 13.6V15M15 8h-1.4M2.4 8H1M12.7 3.3l-1 1M4.3 11.7l-1 1M12.7 12.7l-1-1M4.3 4.3l-1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>; }
function SubmitIcon() { return <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>; }
function SendIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M14.5 1.5 1.5 7l5 2 2 5 6-12.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M6.5 9 14.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>; }
function InfoIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/><path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="8" cy="4.9" r="0.9" fill="currentColor"/></svg>; }
function CheckMiniIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, marginTop: 2 }}><circle cx="8" cy="8" r="7" fill={palette.accentWash}/><path d="m5.2 8.2 1.8 1.8 3.8-4" stroke={palette.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function LinkIcon() { return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5a2.5 2.5 0 0 1 0-3.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-1 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M9.5 6.5a2.5 2.5 0 0 1 0 3.5l-2 2a2.5 2.5 0 0 1-3.5-3.5l1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>; }

function EbwStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .ebw-ui { font-family: 'Inter', system-ui, sans-serif; }
      .ebw-ui * { box-sizing: border-box; }
      .hist-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .hist-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .hist-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      .ebw-input:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 3px ${palette.accentSoft}; }
      .ebw-btn-primary { transition: filter .15s ease, transform .15s ease; }
      .ebw-btn-primary:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
      .ebw-btn-primary:disabled { cursor: not-allowed; }
      .ebw-link { transition: opacity .15s ease; }
      .ebw-link:hover { opacity: 0.75; }
      .ebw-related-card { transition: border-color .15s ease, background-color .15s ease, transform .12s ease; }
      .ebw-related-card:hover:not([data-unavailable="true"]) { transform: translateY(-1px); }
      @media (max-width: 620px) {
        .ebw-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
      }
    `}</style>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';

const muted: React.CSSProperties = { color: palette.slate300, fontSize: 14, margin: 0 };

const box = {
  err: { padding: '10px 14px', borderRadius: 8, background: '#FDECEC', color: '#8F2323', fontSize: 14, marginBottom: 14, border: '1px solid #F3CACA' } as React.CSSProperties,
  ok: { padding: '10px 14px', borderRadius: 8, background: '#E6F4EC', color: '#1F7A45', fontSize: 14, marginBottom: 14, border: '1px solid #1F7A4555' } as React.CSSProperties,
};

const layout: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: 24,
  alignItems: 'start',
};

// Detail card
const detailCard: React.CSSProperties = { border: `1px solid ${palette.slate300}e6`, borderRadius: 16, overflow: 'hidden', background: CARD_BG, boxShadow: CARD_SHADOW };
const imageWrap: React.CSSProperties = { position: 'relative', background: palette.slate50, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const image: React.CSSProperties = { width: '100%', height: 260, objectFit: 'contain', padding: 12 };
const imagePlaceholder: React.CSSProperties = { width: 90, height: 90, borderRadius: '50%', background: `linear-gradient(135deg, ${palette.navy800}, ${palette.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const placeholderLetter: React.CSSProperties = { fontSize: 40, fontWeight: 700, color: '#fff' };
const imageBadge: React.CSSProperties = { position: 'absolute', top: 12, left: 12, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 };
const infoBody: React.CSSProperties = { padding: '20px 22px' };
const equipName: React.CSSProperties = { margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: palette.navy900 };
const badge: React.CSSProperties = { display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 };
const sportTag: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 16px', fontSize: 13, color: palette.slate500 };
const statsGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 };
const statCell: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, background: palette.slate50, border: `1px solid ${palette.slate100}`, borderRadius: 12, padding: '12px 14px' };
const statIconBox: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, background: palette.accentWash, color: palette.accent, flexShrink: 0 };
const statTextCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const statLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: palette.slate500 };
const statValue: React.CSSProperties = { fontSize: 19, fontWeight: 800, color: palette.navy900, lineHeight: 1.1 };
const metaGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
const metaItem: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const metaIconBox: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, background: palette.slate50, border: `1px solid ${palette.slate100}`, color: palette.slate500, flexShrink: 0 };
const metaTextCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1 };
const metaLabel: React.CSSProperties = { fontSize: 11, color: palette.slate500, fontWeight: 600 };
const metaValue: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: palette.navy900 };
const rulesBox: React.CSSProperties = { background: palette.slate50, border: `1px solid ${palette.slate100}`, borderRadius: 10, padding: '14px 16px', marginTop: 20 };
const rulesTitle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: palette.navy900 };
const rulesList: React.CSSProperties = { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12.5, color: palette.slate500, lineHeight: 1.5 };

// Form card
const formCard: React.CSSProperties = { border: `1px solid ${palette.slate300}e6`, borderRadius: 16, padding: '24px', background: CARD_BG, boxShadow: CARD_SHADOW };
const formHeadRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 };
const formHeadIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 12, background: palette.accentWash, color: palette.accent, flexShrink: 0 };
const formTitle: React.CSSProperties = { margin: '0 0 4px', fontSize: 17, fontWeight: 800, color: palette.navy900 };
const formSubtitle: React.CSSProperties = { margin: 0, fontSize: 12.5, color: palette.slate500 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' };
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const fieldLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: palette.navy900 };
const inp: React.CSSProperties = { padding: '9px 10px', borderRadius: 8, border: `1.5px solid ${palette.slate300}`, background: palette.slate50, color: palette.navy900, fontSize: 14, fontFamily: 'inherit' };

const summaryBox: React.CSSProperties = { background: palette.accentWash, border: `1px solid ${palette.accent}33`, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' };
const summaryLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: palette.accent };
const summaryItems: React.CSSProperties = { fontSize: 13, color: palette.navy900 };

const primaryBtn: React.CSSProperties = { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: palette.accent, color: '#fff', fontSize: 15, fontWeight: 700, padding: '12px', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 10px 22px -12px rgba(28,57,142,.75)' };
const primaryBtnDisabled: React.CSSProperties = { opacity: 0.6, cursor: 'not-allowed', boxShadow: 'none' };

const successActions: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 };
const viewRequestsBtn: React.CSSProperties = { padding: '10px 0', borderRadius: 9, border: 'none', background: palette.accent, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const backLink: React.CSSProperties = { background: 'none', border: 'none', color: palette.accent, fontSize: 14, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };

// Frequently bought together section
const relatedSection: React.CSSProperties = { marginTop: 32 };
const relatedHeaderRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 };
const relatedHeaderIcon: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${palette.navy800}, ${palette.accent})`, color: '#fff', flexShrink: 0, boxShadow: '0 6px 14px -6px rgba(3,22,54,0.6)' };
const relatedTitle: React.CSSProperties = { margin: '0 0 4px', fontSize: 17, fontWeight: 800, color: palette.white };
const relatedSubtitle: React.CSSProperties = { margin: 0, fontSize: 13, color: palette.slate300 };
const relatedGrid: React.CSSProperties = { display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 };

const relatedCard: React.CSSProperties = {
  flex: '0 0 200px', width: 200,
  border: `1.5px solid ${palette.slate300}`, borderRadius: 14, overflow: 'hidden',
  background: palette.white, cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
};
const relatedCardTicked: React.CSSProperties = {
  border: `2px solid ${palette.accent}`, boxShadow: `0 0 0 3px ${palette.accentWash}`,
};
const relatedCardUnavailable: React.CSSProperties = {
  opacity: 0.5, cursor: 'not-allowed',
};

const checkbox: React.CSSProperties = {
  position: 'absolute', top: 8, left: 8,
  width: 20, height: 20, borderRadius: 6,
  border: `2px solid ${palette.slate300}`, background: palette.white,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0, boxShadow: '0 2px 6px rgba(3,22,54,0.15)',
};
const checkboxTicked: React.CSSProperties = { background: palette.accent, border: `2px solid ${palette.accent}` };
const checkmark: React.CSSProperties = { color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: 1 };

const relatedThumb: React.CSSProperties = { position: 'relative', width: '100%', height: 110, overflow: 'hidden', flexShrink: 0, background: palette.slate100 };
const relatedThumbImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain', padding: 6 };
const relatedThumbPlaceholder: React.CSSProperties = { width: '100%', height: '100%', background: `linear-gradient(135deg, ${palette.navy800}, ${palette.accent})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, color: '#fff' };

const relatedInfo: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px 12px' };
const relatedNameRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 };
const relatedName: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: palette.navy900, lineHeight: 1.25 };
const relatedBadge: React.CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 };
const relatedEnvTag: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: palette.slate500, fontWeight: 600 };
const relatedHint: React.CSSProperties = { marginTop: 12, fontSize: 13, color: palette.slate100, fontWeight: 600 };

// Shell-level styles (page/header/glass/footer — same tokens as Accounts)
const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobC: { display: 'none' } as const,

  topbar: {
    position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 32px', flexWrap: 'wrap', gap: 12,
  } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } as const,
  logoImg: { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}` } as const,
  wordmark: { fontSize: 16, fontWeight: 700, color: palette.white, lineHeight: 1.2 } as const,
  wordmarkSub: { fontSize: 12, color: palette.slate400, marginTop: 1 } as const,
  topbarRight: { display: 'flex', gap: 10 } as const,
  topBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', color: palette.slate100,
    border: `1.5px solid ${palette.slate400}`, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  } as const,

  main: { position: 'relative', zIndex: 1, flex: 1, padding: '28px 24px 56px', width: '100%', maxWidth: 1160, margin: '0 auto', boxSizing: 'border-box' } as const,
  /* Frosted glassmorphism shell around everything below the header — same
     treatment as Usage History, Accounts, Offline Fallback Entry, Conflict
     Detection, Venue Calendar, and Kit Borrow. */
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 24px 32px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,

  headRow: { marginBottom: 22 } as const,
  accentBar: { display: 'none' } as const,
  eyebrow: {
    display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 10,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  title: { fontSize: 30, fontWeight: 800, color: palette.white, margin: 0, letterSpacing: '-0.5px' } as const,
  subtitle: { fontSize: 14, color: palette.slate300, margin: '6px 0 0' } as const,

  footer: { position: 'relative', zIndex: 1, textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55` } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,
};
