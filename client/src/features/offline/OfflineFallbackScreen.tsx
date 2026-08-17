/**
 * Offline Fallback Entry Form (Feature 11).
 *
 * Staff-only (COORDINATOR + SUPER_ADMIN — enforced by the route guard in
 * App.tsx, unchanged). Supports three transaction types per OFFL-04:
 * BOOKING, BORROW, RETURN. Each form captures the same fields as the
 * equivalent live-system transaction (OFFL-05), with the actual event
 * time from the paper log — not the current time.
 *
 * Entries are submitted one at a time (OFFL-08). On success the form resets
 * for the next sequential paper-logged entry.
 *
 * NOTE — visual-only pass: this file owns its own page chrome (header,
 * blobs, cards, animated segmented controls) instead of <PortalShell>, so
 * the refresh stays scoped to this screen. Every handler, request shape,
 * and validation rule below is byte-for-byte the same as before — only the
 * rendering layer changed.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { palette } from '../auth/AuthUI.js';
import { ApiRequestError } from '../../lib/api.js';
import * as offlineApi from './api.js';
import type { AuditEntry } from './api.js';

type TxnKind      = 'BOOKING' | 'BORROW' | 'RETURN';
type BorrowerKind = 'REGISTERED' | 'GUEST';
type Condition    = 'GOOD' | 'WORN' | 'DAMAGED';

interface FormState {
  kind: TxnKind;
  // Booking
  venueId: string;
  purpose: string;
  estimatedParticipants: string;
  sessionStartAt: string;
  sessionEndAt: string;
  teamName: string;
  participantDetails: string;
  // Borrow
  borrowerKind: BorrowerKind;
  enrollmentNo: string;
  guestFullName: string;
  guestIdNumber: string;
  guestContactNumber: string;
  equipmentTypeId: string;
  articleIds: string;
  agreedStartAt: string;
  agreedReturnAt: string;
  // Return
  borrowTxnId: string;
  returnArticleIds: string;
  returnedAt: string;
  condition: Condition;
  // Shared
  note: string;
}

const EMPTY: FormState = {
  kind: 'BORROW',
  venueId: '', purpose: '', estimatedParticipants: '',
  sessionStartAt: '', sessionEndAt: '', teamName: '', participantDetails: '',
  borrowerKind: 'REGISTERED', enrollmentNo: '',
  guestFullName: '', guestIdNumber: '', guestContactNumber: '',
  equipmentTypeId: '', articleIds: '',
  agreedStartAt: '', agreedReturnAt: '',
  borrowTxnId: '', returnArticleIds: '', returnedAt: '', condition: 'GOOD',
  note: '',
};

const TXN_TABS: { value: TxnKind; label: string; icon: (a: boolean) => React.ReactNode }[] = [
  { value: 'BOOKING', label: 'Booking', icon: (a) => <TabCalendarIcon active={a} /> },
  { value: 'BORROW',  label: 'Borrow',  icon: (a) => <TabBoxIcon active={a} /> },
  { value: 'RETURN',  label: 'Return',  icon: (a) => <TabReturnIcon active={a} /> },
];

export default function OfflineFallbackScreen() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [form, setForm]         = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]   = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[] | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSuccess(null);
    setError(null);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSuccess(null);
    setError(null);

    try {
      if (form.kind === 'BOOKING') {
        const res = await offlineApi.enterFallbackBooking({
          venueId:               Number(form.venueId),
          purpose:               form.purpose,
          estimatedParticipants: Number(form.estimatedParticipants),
          sessionStartAt:        form.sessionStartAt,
          sessionEndAt:          form.sessionEndAt,
          teamName:              form.teamName,
          participantDetails:    form.participantDetails || undefined,
          note:                  form.note || undefined,
        });
        setSuccess(`Booking synced. Booking ID: ${res.bookingId}`);

      } else if (form.kind === 'BORROW') {
        const articleIds = form.articleIds.split(',').map((s) => s.trim()).filter(Boolean);
        const base = {
          equipmentTypeId: Number(form.equipmentTypeId),
          articleIds,
          agreedStartAt:   form.agreedStartAt,
          agreedReturnAt:  form.agreedReturnAt,
          note:            form.note || undefined,
        };
        const input: offlineApi.FallbackBorrowInput =
          form.borrowerKind === 'REGISTERED'
            ? { borrowerKind: 'REGISTERED', enrollmentNo: form.enrollmentNo, ...base }
            : { borrowerKind: 'GUEST', guestFullName: form.guestFullName,
                guestIdNumber: form.guestIdNumber, guestContactNumber: form.guestContactNumber, ...base };
        const res = await offlineApi.enterFallbackBorrow(input);
        setSuccess(`Borrow synced. Transaction ID: ${res.borrowTxnId}`);

      } else {
        const articleIds = form.returnArticleIds.split(',').map((s) => s.trim()).filter(Boolean);
        const res = await offlineApi.enterFallbackReturn({
          borrowTxnId: form.borrowTxnId,
          articleIds,
          returnedAt:  form.returnedAt,
          condition:   form.condition,
          note:        form.note || undefined,
        });
        setSuccess(`Return synced. Final status: ${res.status}`);
      }

      // OFFL-08: reset for next sequential entry, keeping the same transaction type
      setForm((prev) => ({ ...EMPTY, kind: prev.kind }));

    } catch (e) {
      setError(e instanceof ApiRequestError ? e.body.error : 'Unexpected error — check your input and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function loadAudit() {
    setLoadingAudit(true);
    try {
      const data = await offlineApi.getAuditLog();
      setAuditLog(data.entries);
    } catch {
      setAuditLog([]);
    } finally {
      setLoadingAudit(false);
    }
  }

  const tabIndex = TXN_TABS.findIndex((t) => t.value === form.kind);
  const kindLabel = form.kind === 'BOOKING' ? 'Booking' : form.kind === 'BORROW' ? 'Borrow' : 'Return';

  return (
    <Shell onBack={() => navigate('/home')} onSignOut={() => { void logout(); navigate('/'); }}>
      <div style={wrap}>

        {/* Info banner */}
        <div style={banner} className="ofl-fade-in">
          <span style={bannerIconWrap}><InfoGlyph /></span>
          <div>
            <strong style={bannerTitle}>Offline Fallback Entry Form</strong>
            <p style={bannerText}>
              Enter each paper-logged transaction <em>one at a time in the order it occurred</em> (OFFL-08).
              Use the <strong>actual event time from the paper log</strong> — not the current time.
              Every entry is written immediately to the live database (OFFL-09) and participates
              fully in all downstream features.
            </p>
          </div>
        </div>

        {/* Transaction type segmented control */}
        <div style={{ ...glassCard, ...sectionPad, marginBottom: 20 }} className="ofl-fade-in">
          <label style={sectionLabel}>Transaction Type</label>
          <div style={{ ...segWrap, gridTemplateColumns: `repeat(${TXN_TABS.length}, 1fr)` }} className="ofl-seg-wrap">
            <span
              className="ofl-seg-thumb"
              style={{ width: `calc(${100 / TXN_TABS.length}% - 6px)`, transform: `translateX(calc(${tabIndex} * (100% + 6px)))` }}
            />
            {TXN_TABS.map((t) => {
              const active = form.kind === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  className="ofl-seg-btn"
                  style={{ ...segBtn, color: active ? '#fff' : NAVY }}
                  onClick={() => { setForm({ ...EMPTY, kind: t.value }); setSuccess(null); setError(null); }}
                >
                  {t.icon(active)} {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── BOOKING ── */}
        {form.kind === 'BOOKING' && (
          <div key="booking" style={{ ...glassCard, ...sectionPad, marginBottom: 20 }} className="ofl-slide-in">
            <SectionHeading icon={<CalendarGlyph />} title="Venue Booking" />
            <Field label="Venue ID *" hint="Numeric ID from the Venues list">
              <input className="ofl-input" style={inp} type="number" min={1} value={form.venueId}
                onChange={(e) => set('venueId', e.target.value)} />
            </Field>
            <Field label="Purpose *">
              <input className="ofl-input" style={inp} value={form.purpose}
                onChange={(e) => set('purpose', e.target.value)} />
            </Field>
            <Field label="Estimated Participants *">
              <input className="ofl-input" style={inp} type="number" min={1} value={form.estimatedParticipants}
                onChange={(e) => set('estimatedParticipants', e.target.value)} />
            </Field>
            <TwoCol>
              <Field label="Session Start * (actual event time)">
                <input className="ofl-input" style={inp} type="datetime-local" value={toLocal(form.sessionStartAt)}
                  onChange={(e) => set('sessionStartAt', toIso(e.target.value))} />
              </Field>
              <Field label="Session End * (actual event time)">
                <input className="ofl-input" style={inp} type="datetime-local" value={toLocal(form.sessionEndAt)}
                  onChange={(e) => set('sessionEndAt', toIso(e.target.value))} />
              </Field>
            </TwoCol>
            <Field label="Team Name *">
              <input className="ofl-input" style={inp} value={form.teamName}
                onChange={(e) => set('teamName', e.target.value)} />
            </Field>
            <Field label="Participant Details">
              <input className="ofl-input" style={inp} value={form.participantDetails}
                onChange={(e) => set('participantDetails', e.target.value)}
                placeholder="Optional — player names, squad details, etc." />
            </Field>
          </div>
        )}

        {/* ── BORROW ── */}
        {form.kind === 'BORROW' && (
          <div key="borrow" style={{ ...glassCard, ...sectionPad, marginBottom: 20 }} className="ofl-slide-in">
            <SectionHeading icon={<BoxGlyph />} title="Equipment Borrow" />

            <Field label="Borrower Type">
              <div style={{ ...segWrap, gridTemplateColumns: 'repeat(2, 1fr)', maxWidth: 380 }} className="ofl-seg-wrap ofl-seg-wrap-sm">
                <span
                  className="ofl-seg-thumb"
                  style={{ width: 'calc(50% - 6px)', transform: `translateX(calc(${form.borrowerKind === 'REGISTERED' ? 0 : 1} * (100% + 6px)))` }}
                />
                {(['REGISTERED', 'GUEST'] as BorrowerKind[]).map((k) => {
                  const active = form.borrowerKind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      className="ofl-seg-btn"
                      style={{ ...segBtn, color: active ? '#fff' : NAVY, fontSize: 12.5 }}
                      onClick={() => set('borrowerKind', k)}
                    >
                      {k === 'REGISTERED' ? 'Registered Student' : 'Walk-in Guest'}
                    </button>
                  );
                })}
              </div>
            </Field>

            {form.borrowerKind === 'REGISTERED' ? (
              <div key="reg" className="ofl-fade-in">
                <Field label="Enrollment Number *">
                  <input className="ofl-input" style={inp} value={form.enrollmentNo}
                    onChange={(e) => set('enrollmentNo', e.target.value)}
                    placeholder="e.g. 84-024000-001" />
                </Field>
              </div>
            ) : (
              <div key="guest" className="ofl-fade-in">
                <Field label="Guest Full Name *">
                  <input className="ofl-input" style={inp} value={form.guestFullName}
                    onChange={(e) => set('guestFullName', e.target.value)} />
                </Field>
                <TwoCol>
                  <Field label="Guest ID Number *">
                    <input className="ofl-input" style={inp} value={form.guestIdNumber}
                      onChange={(e) => set('guestIdNumber', e.target.value)} />
                  </Field>
                  <Field label="Guest Contact *">
                    <input className="ofl-input" style={inp} value={form.guestContactNumber}
                      onChange={(e) => set('guestContactNumber', e.target.value)} />
                  </Field>
                </TwoCol>
              </div>
            )}

            <TwoCol>
              <Field label="Equipment Type ID *" hint="Numeric ID from inventory">
                <input className="ofl-input" style={inp} type="number" min={1} value={form.equipmentTypeId}
                  onChange={(e) => set('equipmentTypeId', e.target.value)} />
              </Field>
              <Field label="Article UUID(s) *" hint="Comma-separated">
                <input className="ofl-input" style={inp} value={form.articleIds}
                  onChange={(e) => set('articleIds', e.target.value)}
                  placeholder="uuid, uuid" />
              </Field>
            </TwoCol>
            <TwoCol>
              <Field label="Agreed Start * (actual event time)">
                <input className="ofl-input" style={inp} type="datetime-local" value={toLocal(form.agreedStartAt)}
                  onChange={(e) => set('agreedStartAt', toIso(e.target.value))} />
              </Field>
              <Field label="Agreed Return * (actual event time)">
                <input className="ofl-input" style={inp} type="datetime-local" value={toLocal(form.agreedReturnAt)}
                  onChange={(e) => set('agreedReturnAt', toIso(e.target.value))} />
              </Field>
            </TwoCol>
          </div>
        )}

        {/* ── RETURN ── */}
        {form.kind === 'RETURN' && (
          <div key="return" style={{ ...glassCard, ...sectionPad, marginBottom: 20 }} className="ofl-slide-in">
            <SectionHeading icon={<ReturnGlyph />} title="Equipment Return" />
            <Field label="Borrow Transaction ID *" hint="UUID of the active borrow transaction">
              <input className="ofl-input" style={inp} value={form.borrowTxnId}
                onChange={(e) => set('borrowTxnId', e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </Field>
            <Field label="Article UUID(s) *" hint="Comma-separated UUIDs being returned">
              <input className="ofl-input" style={inp} value={form.returnArticleIds}
                onChange={(e) => set('returnArticleIds', e.target.value)}
                placeholder="uuid, uuid" />
            </Field>
            <TwoCol>
              <Field label="Actual Return Time * (from paper log)">
                <input className="ofl-input" style={inp} type="datetime-local" value={toLocal(form.returnedAt)}
                  onChange={(e) => set('returnedAt', toIso(e.target.value))} />
              </Field>
              <Field label="Return Condition *">
                <select className="ofl-input" style={{ ...inp, appearance: 'auto' }} value={form.condition}
                  onChange={(e) => set('condition', e.target.value as Condition)}>
                  <option value="GOOD">Good</option>
                  <option value="WORN">Worn</option>
                  <option value="DAMAGED">Damaged</option>
                </select>
              </Field>
            </TwoCol>
          </div>
        )}

        {/* Note (shared) */}
        <div style={{ ...glassCard, ...sectionPad, marginBottom: 20 }} className="ofl-fade-in">
          <Field label="Note (optional)" hint="Paper log page/entry reference, coordinator remarks">
            <input className="ofl-input" style={inp} value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="e.g. Paper log p.3 entry #7" />
          </Field>
        </div>

        {error && (
          <div style={box.err} className="ofl-alert">
            <AlertGlyph /> <span>{error}</span>
          </div>
        )}
        {success && (
          <div style={box.ok} className="ofl-alert">
            <CheckGlyph /> <span>{success}</span>
          </div>
        )}

        <button className="ofl-submit-btn" style={submitBtn} onClick={handleSubmit} disabled={submitting}>
          {submitting ? (
            <>
              <span className="ofl-spin" style={btnSpinner} /> Syncing…
            </>
          ) : (
            <>
              <SyncGlyph /> Sync {kindLabel} Entry
            </>
          )}
        </button>

        <p style={hintText}>
          Entries are validated with the same conflict and inventory rules as live transactions.
          If an entry is rejected, resolve the discrepancy from the paper log before re-submitting (OFFL-06/07).
        </p>

        {/* Audit log panel */}
        <div style={{ ...glassCard, marginTop: 28, marginBottom: 12 }} className="ofl-fade-in">
          <div style={panelHead}>
            <span style={panelHeadIcon}><AuditGlyph /></span>
            Fallback Entry Audit Log
            <button className="ofl-load-btn" style={loadBtn} onClick={loadAudit} disabled={loadingAudit}>
              {loadingAudit ? (
                <><span className="ofl-spin" style={loadSpinner} /> Loading…</>
              ) : (
                <>Load Audit Log</>
              )}
            </button>
          </div>
          <div style={panelBody}>
            {auditLog === null && (
              <p style={muted}>Click "Load Audit Log" to view all fallback entries (OFFL-15/17).</p>
            )}
            {auditLog !== null && auditLog.length === 0 && (
              <p style={muted}>No fallback entries recorded yet.</p>
            )}
            {auditLog !== null && auditLog.length > 0 && (
              <div style={auditList}>
                {auditLog.map((e, i) => (
                  <div key={e.audit_id} className="ofl-audit-row" style={{ ...auditRow, animationDelay: `${i * 40}ms` }}>
                    <span style={{ ...kindBadge, ...kindBadgeColor(e.transaction_kind) }}>{e.transaction_kind}</span>
                    <div style={auditMain}>
                      <span style={auditWho}>{e.entered_by_name}</span>
                      <span style={auditRole}>{e.entered_by_role}</span>
                    </div>
                    <span style={auditWhen}>{new Date(e.entered_at).toLocaleString()}</span>
                    <span style={auditNote}>{e.note ?? '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Helpers ──

function toLocal(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}

function toIso(local: string): string {
  if (!local) return '';
  try { return new Date(local).toISOString(); } catch { return ''; }
}

function kindBadgeColor(k: string): React.CSSProperties {
  if (k === 'BOOKING') return { background: '#e4edf6', color: '#0e5da8' };
  if (k === 'BORROW')  return { background: '#DFF0E8', color: GREEN_DARK };
  return { background: '#fdf1de', color: '#a5610f' };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={fieldLabel}>{label}</label>
      {hint && <p style={fieldHint}>{hint}</p>}
      {children}
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div style={twoCol}>{children}</div>;
}

function SectionHeading({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={sectionHeading}>
      <span style={sectionHeadingIcon}>{icon}</span>
      <h3 style={sectionHeadingTitle}>{title}</h3>
    </div>
  );
}

/* ————————————————————— Page chrome (header + blobbed background) ————————————————————— */

function Shell({ onBack, onSignOut, children }: { onBack: () => void; onSignOut: () => void; children: React.ReactNode }) {
  return (
    <div style={page}>
      <style>{OFL_CSS}</style>
      <div className="ofl-blob ofl-blob-a" aria-hidden />
      <div className="ofl-blob ofl-blob-b" aria-hidden />
      <div className="ofl-blob ofl-blob-c" aria-hidden />
      <div className="ofl-blob ofl-blob-d" aria-hidden />

      <header style={topbar}>
        <div style={brandRow}>
          <span style={crest}>BU</span>
          <span style={wordmark}>Bahria University</span>
        </div>
        <div style={headerActions}>
          <button type="button" className="ofl-back-btn" style={backBtn} onClick={onBack}>
            <BackGlyph /> Back
          </button>
          <button type="button" className="ofl-signout-btn" style={signOutBtn} onClick={onSignOut}>
            <SignOutGlyph /> Sign out
          </button>
        </div>
      </header>

      <div style={titleBand}>
        <span style={eyebrow}>Staff Tools</span>
        <h1 style={pageTitle}>Offline Fallback Entry</h1>
      </div>

      <main style={main}>{children}</main>

      <footer style={footer}>
        2026 © <a href="/" style={footerLink}>Bahria University</a>
      </footer>
    </div>
  );
}

/* ————————————————————————————————— Inline glyphs ————————————————————————————————— */

const GREEN = '#498473';
const GREEN_DARK = '#356255';
const NAVY = '#0B3754';
const MINT = '#DFF0E8';
const SKY = '#E4EDF6';
const PAPER = '#EFF9F5';
const AMBER = '#a5610f';

function BackGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M9.5 3 4 8l5.5 5" stroke={GREEN_DARK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 8H13" stroke={GREEN_DARK} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function SignOutGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
      <path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function InfoGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#fdf1de" stroke={AMBER} strokeWidth="1.6" />
      <path d="M12 11v5.5" stroke={AMBER} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="7.7" r="1.05" fill={AMBER} />
    </svg>
  );
}
function CalendarGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="5.5" width="16" height="14.5" rx="1.8" stroke={NAVY} strokeWidth="1.6" />
      <path d="M4 9.5h16M8 3.5v4M16 3.5v4" stroke={NAVY} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function BoxGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z" stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3.7 7.6 12 11.5l8.3-3.9M12 11.5v9" stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function ReturnGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M4 4v6h6" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.6 15a8 8 0 1 0 2-8.4L4 10" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TabCalendarIcon({ active }: { active: boolean }) {
  const c = active ? '#fff' : NAVY;
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="5.5" width="16" height="14.5" rx="1.8" stroke={c} strokeWidth="1.8" />
      <path d="M4 9.5h16M8 3.5v4M16 3.5v4" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function TabBoxIcon({ active }: { active: boolean }) {
  const c = active ? '#fff' : NAVY;
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3.7 7.6 12 11.5l8.3-3.9M12 11.5v9" stroke={c} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function TabReturnIcon({ active }: { active: boolean }) {
  const c = active ? '#fff' : NAVY;
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M4 4v6h6" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.6 15a8 8 0 1 0 2-8.4L4 10" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SyncGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M4 4v6h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.6 15a8 8 0 1 0 2-8.4L4 10" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AuditGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M8 6h13M8 12h13M8 18h13" stroke={NAVY} strokeWidth="2" strokeLinecap="round" />
      <circle cx="3.5" cy="6" r="1.5" fill={GREEN} />
      <circle cx="3.5" cy="12" r="1.5" fill={GREEN} />
      <circle cx="3.5" cy="18" r="1.5" fill={GREEN} />
    </svg>
  );
}
function AlertGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 3 2 21h20L12 3Z" fill="#991b1b" fillOpacity="0.14" stroke="#991b1b" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10v5" stroke="#991b1b" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17.6" r="1" fill="#991b1b" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="#166534" fillOpacity="0.14" stroke="#166534" strokeWidth="1.6" />
      <path d="m7.5 12.5 3 3 6-6.5" stroke="#166534" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ————————————————————————————————————— CSS (blobs / hover / motion) ————————————————————————————————————— */

const OFL_CSS = `
@keyframes oflFloatA { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(30px,-24px) scale(1.06); } }
@keyframes oflFloatB { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-26px,20px) scale(1.08); } }
@keyframes oflFloatC { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(18px,26px) scale(1.05); } }
@keyframes oflFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes oflSlideIn { from { opacity: 0; transform: translateY(14px) scale(0.99); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes oflSpin { to { transform: rotate(360deg); } }
@keyframes oflRowIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }

.ofl-blob { position: fixed; border-radius: 50%; filter: blur(10px); pointer-events: none; z-index: 0; }
.ofl-blob-a { width: 340px; height: 340px; top: -140px; left: -100px; background: #49847322; animation: oflFloatA 26s ease-in-out infinite; }
.ofl-blob-b { width: 300px; height: 300px; bottom: -160px; right: -80px; background: #0B375418; animation: oflFloatB 30s ease-in-out infinite; }
.ofl-blob-c { width: 260px; height: 260px; top: 32%; right: -120px; background: #DFF0E866; animation: oflFloatC 22s ease-in-out infinite; }
.ofl-blob-d { width: 220px; height: 220px; bottom: 14%; left: 6%; background: #E4EDF677; animation: oflFloatB 24s ease-in-out infinite; }

.ofl-fade-in { animation: oflFadeIn 0.45s ease both; }
.ofl-slide-in { animation: oflSlideIn 0.32s cubic-bezier(0.22,1,0.36,1) both; }
.ofl-alert { animation: oflFadeIn 0.3s ease both; }

.ofl-back-btn, .ofl-signout-btn { transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
.ofl-back-btn:hover { background: #DFF0E8; border-color: #498473aa; color: #356255; }
.ofl-signout-btn:hover { background: #FDECEC; border-color: #F3CACA; color: #8F2323; }

.ofl-input { transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease; }
.ofl-input:focus { outline: none; border-color: #498473 !important; box-shadow: 0 0 0 3px rgba(73,132,115,0.16); background: #fff !important; }
.ofl-input:hover { border-color: #498473aa; }

.ofl-seg-wrap { position: relative; display: grid; gap: 6px; background: #eef4f1; border-radius: 12px; padding: 5px; }
.ofl-seg-thumb {
  position: absolute; top: 5px; left: 5px; bottom: 5px; border-radius: 9px;
  background: linear-gradient(135deg, #498473, #356255);
  box-shadow: 0 4px 12px rgba(73,132,115,0.35);
  transition: transform 0.28s cubic-bezier(0.22,1,0.36,1);
  z-index: 0;
}
.ofl-seg-btn {
  position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  background: transparent; border: none; cursor: pointer; padding: 9px 10px; border-radius: 9px;
  font: 700 13px var(--font-body); transition: color 0.2s ease;
}

.ofl-submit-btn { transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease; }
.ofl-submit-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.05); box-shadow: 0 10px 22px rgba(73,132,115,0.38); }
.ofl-submit-btn:active:not(:disabled) { transform: translateY(0); }
.ofl-submit-btn:disabled { opacity: 0.7; cursor: not-allowed; }

.ofl-load-btn { transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease; }
.ofl-load-btn:hover:not(:disabled) { background: #DFF0E8; border-color: #498473aa; transform: translateY(-1px); }
.ofl-load-btn:disabled { opacity: 0.7; cursor: not-allowed; }

.ofl-audit-row { animation: oflRowIn 0.32s ease both; transition: transform 0.15s ease, box-shadow 0.15s ease; }
.ofl-audit-row:hover { transform: translateX(2px); box-shadow: 0 4px 14px rgba(11,55,84,0.08); }

.ofl-spin { animation: oflSpin 0.85s linear infinite; }

@media (max-width: 620px) {
  .ofl-seg-wrap { grid-template-columns: 1fr !important; }
  .ofl-seg-thumb { display: none; }
}
`;

/* ————————————————————————————————————— Style objects ————————————————————————————————————— */

const page: React.CSSProperties = {
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
  background: `radial-gradient(1200px 600px at 10% -10%, ${SKY} 0%, transparent 55%),
               radial-gradient(1000px 600px at 100% 0%, ${MINT} 0%, transparent 55%),
               ${PAPER}`,
  fontFamily: 'var(--font-body)',
};

const topbar: React.CSSProperties = {
  position: 'relative', zIndex: 2,
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '20px 40px', borderBottom: `1px solid ${palette.line}`,
};
const brandRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const crest: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 9, background: NAVY,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: '#fff', fontFamily: 'Poppins, sans-serif', fontWeight: 800, fontSize: 13,
};
const wordmark: React.CSSProperties = { fontFamily: 'Poppins, sans-serif', fontSize: 18, fontWeight: 600, color: NAVY };
const headerActions: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const backBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: GREEN_DARK,
  border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};
const signOutBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', color: palette.muted,
  border: `1.5px solid ${palette.line}`, borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
};

const titleBand: React.CSSProperties = { position: 'relative', zIndex: 2, textAlign: 'center', padding: '30px 24px 14px' };
const eyebrow: React.CSSProperties = {
  display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
  color: GREEN_DARK, background: 'rgba(73,132,115,0.12)', padding: '4px 12px', borderRadius: 999, marginBottom: 10,
};
const pageTitle: React.CSSProperties = {
  margin: 0, fontSize: 32, fontWeight: 800, color: NAVY, letterSpacing: '-0.01em',
  fontFamily: 'var(--font-display, "Segoe UI"), system-ui, sans-serif',
};

const main: React.CSSProperties = { position: 'relative', zIndex: 2, flex: 1, padding: '28px 24px 56px' };

const footer: React.CSSProperties = {
  position: 'relative', zIndex: 2, textAlign: 'center', padding: '16px 24px', fontSize: 13, color: '#3d5b52',
  borderTop: '1px solid rgba(73,132,115,0.2)',
};
const footerLink: React.CSSProperties = { color: GREEN_DARK, textDecoration: 'none', fontWeight: 600 };

const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto' };

const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.74)',
  backdropFilter: 'blur(14px)',
  WebkitBackdropFilter: 'blur(14px)',
  border: '1px solid rgba(255,255,255,0.6)',
  borderRadius: 18,
  boxShadow: '0 8px 30px rgba(11,55,84,0.08)',
  overflow: 'hidden',
};
const sectionPad: React.CSSProperties = { padding: '20px 24px 22px' };

const banner: React.CSSProperties = {
  display: 'flex', gap: 14, alignItems: 'flex-start',
  background: 'rgba(253,241,222,0.85)', border: '1px solid #e8b26a',
  borderRadius: 16, padding: '16px 20px', marginBottom: 20,
  backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
};
const bannerIconWrap: React.CSSProperties = { flexShrink: 0, marginTop: 1 };
const bannerTitle: React.CSSProperties = { color: AMBER, fontSize: 14, fontWeight: 800 };
const bannerText: React.CSSProperties = { margin: '6px 0 0', fontSize: 13, lineHeight: 1.65, color: '#7a4c17' };

const sectionLabel: React.CSSProperties = {
  display: 'block', fontWeight: 800, fontSize: 12, color: NAVY, marginBottom: 10,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const segWrap: React.CSSProperties = { display: 'grid' };
const segBtn: React.CSSProperties = { fontFamily: 'inherit' };

const sectionHeading: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 };
const sectionHeadingIcon: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 9, background: MINT,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
const sectionHeadingTitle: React.CSSProperties = { margin: 0, fontSize: 15.5, fontWeight: 800, color: NAVY };

const fieldLabel: React.CSSProperties = { display: 'block', fontWeight: 700, fontSize: 13, color: '#1a2b33', marginBottom: 6 };
const fieldHint: React.CSSProperties = { margin: '0 0 6px', fontSize: 11.5, color: '#7c8a90' };
const inp: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: 14, padding: '10px 13px',
  border: '1.5px solid rgba(11,55,84,0.14)', borderRadius: 10, background: 'rgba(255,255,255,0.7)',
  color: '#1a2b33', outline: 'none', fontFamily: 'inherit',
};
const twoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };

const hintText: React.CSSProperties = { marginTop: 14, fontSize: 12, color: '#5c6f75', lineHeight: 1.7, textAlign: 'center' };

const submitBtn: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
  background: `linear-gradient(135deg, ${GREEN}, ${GREEN_DARK})`, color: '#fff', border: 'none',
  borderRadius: 12, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
  boxShadow: '0 6px 18px rgba(73,132,115,0.32)', fontFamily: 'inherit',
};
const btnSpinner: React.CSSProperties = {
  width: 15, height: 15, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.4)',
  borderTopColor: '#fff', display: 'inline-block',
};

const panelHead: React.CSSProperties = {
  padding: '14px 22px', borderBottom: '1px solid rgba(11,55,84,0.08)',
  font: '700 14.5px var(--font-body)', color: NAVY,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(239,249,245,0.5))',
  display: 'flex', alignItems: 'center', gap: 10,
};
const panelHeadIcon: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 8, background: MINT,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
const panelBody: React.CSSProperties = { padding: '16px 22px 20px' };
const loadBtn: React.CSSProperties = {
  marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '7px 14px', border: '1.5px solid rgba(11,55,84,0.16)', borderRadius: 9,
  background: '#fff', color: NAVY, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
};
const loadSpinner: React.CSSProperties = {
  width: 12, height: 12, borderRadius: '50%', border: `2px solid ${MINT}`,
  borderTopColor: GREEN, display: 'inline-block',
};
const muted: React.CSSProperties = { color: '#7c8a90', fontSize: 13.5, margin: 0 };

const auditList: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const auditRow: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14,
  background: '#fff', border: '1px solid rgba(11,55,84,0.07)', borderRadius: 12,
  padding: '10px 14px', boxShadow: '0 2px 8px rgba(11,55,84,0.04)',
};
const kindBadge: React.CSSProperties = {
  display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 10.5, fontWeight: 800,
  fontFamily: 'var(--font-mono)', letterSpacing: '0.03em', flexShrink: 0,
};
const auditMain: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 130 };
const auditWho: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#1a2b33' };
const auditRole: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: '#8a949f', textTransform: 'uppercase', letterSpacing: '0.03em' };
const auditWhen: React.CSSProperties = { fontSize: 12, color: '#5c6f75', fontFamily: 'var(--font-mono)', minWidth: 140 };
const auditNote: React.CSSProperties = { fontSize: 12, color: '#8a949f', flex: 1, minWidth: 100 };

const box = {
  err: {
    display: 'flex', alignItems: 'center', gap: 9,
    background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: '11px 16px',
    color: '#991b1b', marginBottom: 14, fontSize: 13.5, fontWeight: 600,
  } as React.CSSProperties,
  ok: {
    display: 'flex', alignItems: 'center', gap: 9,
    background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, padding: '11px 16px',
    color: '#166534', marginBottom: 14, fontSize: 13.5, fontWeight: 600,
  } as React.CSSProperties,
};
