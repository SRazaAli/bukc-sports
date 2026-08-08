/**
 * Offline Fallback Entry Form (Feature 11).
 *
 * Staff-only (COORDINATOR + SUPER_ADMIN). Supports three transaction types
 * per OFFL-04: BOOKING, BORROW, RETURN. Each form captures the same fields
 * as the equivalent live-system transaction (OFFL-05), with the actual event
 * time from the paper log — not the current time.
 *
 * Entries are submitted one at a time (OFFL-08). On success the form resets
 * for the next sequential paper-logged entry.
 */
import { useState } from 'react';
import { PortalShell, PrimaryButton, fs } from '../auth/PortalShell.js';
import { ApiRequestError } from '../../lib/api.js';
import * as offlineApi from './api.js';
import type { AuditEntry } from './api.js';

type TxnKind     = 'BOOKING' | 'BORROW' | 'RETURN';
type BorrowerKind = 'REGISTERED' | 'GUEST';
type Condition   = 'GOOD' | 'WORN' | 'DAMAGED';

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

export default function OfflineFallbackScreen() {
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
        setSuccess(`✓ Booking synced. Booking ID: ${res.bookingId}`);

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
        setSuccess(`✓ Borrow synced. Transaction ID: ${res.borrowTxnId}`);

      } else {
        const articleIds = form.returnArticleIds.split(',').map((s) => s.trim()).filter(Boolean);
        const res = await offlineApi.enterFallbackReturn({
          borrowTxnId: form.borrowTxnId,
          articleIds,
          returnedAt:  form.returnedAt,
          condition:   form.condition,
          note:        form.note || undefined,
        });
        setSuccess(`✓ Return synced. Final status: ${res.status}`);
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

  return (
    <PortalShell title="Offline Fallback Entry" tint="slate">
      <div style={{ maxWidth: 700, margin: '0 auto' }}>

        {/* Info banner */}
        <div style={s.banner}>
          <strong>Offline Fallback Entry Form</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>
            Enter each paper-logged transaction <em>one at a time in the order it occurred</em> (OFFL-08).
            Use the <strong>actual event time from the paper log</strong> — not the current time.
            Every entry is written immediately to the live database (OFFL-09) and participates
            fully in all downstream features.
          </p>
        </div>

        {/* Transaction type tabs */}
        <div style={s.section}>
          <label style={fs.label}>Transaction Type</label>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {(['BOOKING', 'BORROW', 'RETURN'] as TxnKind[]).map((k) => (
              <button key={k} style={{ ...s.tab, ...(form.kind === k ? s.tabActive : {}) }}
                onClick={() => { setForm({ ...EMPTY, kind: k }); setSuccess(null); setError(null); }}>
                {k}
              </button>
            ))}
          </div>
        </div>

        {/* ── BOOKING ── */}
        {form.kind === 'BOOKING' && (
          <div style={s.section}>
            <h3 style={s.sectionTitle}>Venue Booking</h3>
            <Field label="Venue ID *" hint="Numeric ID from the Venues list">
              <input style={fs.input} type="number" min={1} value={form.venueId}
                onChange={(e) => set('venueId', e.target.value)} />
            </Field>
            <Field label="Purpose *">
              <input style={fs.input} value={form.purpose}
                onChange={(e) => set('purpose', e.target.value)} />
            </Field>
            <Field label="Estimated Participants *">
              <input style={fs.input} type="number" min={1} value={form.estimatedParticipants}
                onChange={(e) => set('estimatedParticipants', e.target.value)} />
            </Field>
            <TwoCol>
              <Field label="Session Start * (actual event time)">
                <input style={fs.input} type="datetime-local" value={toLocal(form.sessionStartAt)}
                  onChange={(e) => set('sessionStartAt', toIso(e.target.value))} />
              </Field>
              <Field label="Session End * (actual event time)">
                <input style={fs.input} type="datetime-local" value={toLocal(form.sessionEndAt)}
                  onChange={(e) => set('sessionEndAt', toIso(e.target.value))} />
              </Field>
            </TwoCol>
            <Field label="Team Name *">
              <input style={fs.input} value={form.teamName}
                onChange={(e) => set('teamName', e.target.value)} />
            </Field>
            <Field label="Participant Details">
              <input style={fs.input} value={form.participantDetails}
                onChange={(e) => set('participantDetails', e.target.value)}
                placeholder="Optional — player names, squad details, etc." />
            </Field>
          </div>
        )}

        {/* ── BORROW ── */}
        {form.kind === 'BORROW' && (
          <div style={s.section}>
            <h3 style={s.sectionTitle}>Equipment Borrow</h3>

            <Field label="Borrower Type">
              <div style={{ display: 'flex', gap: 8 }}>
                {(['REGISTERED', 'GUEST'] as BorrowerKind[]).map((k) => (
                  <button key={k}
                    style={{ ...s.tab, ...(form.borrowerKind === k ? s.tabActive : {}) }}
                    onClick={() => set('borrowerKind', k)}>
                    {k === 'REGISTERED' ? 'Registered Student' : 'Walk-in Guest'}
                  </button>
                ))}
              </div>
            </Field>

            {form.borrowerKind === 'REGISTERED' ? (
              <Field label="Enrollment Number *">
                <input style={fs.input} value={form.enrollmentNo}
                  onChange={(e) => set('enrollmentNo', e.target.value)}
                  placeholder="e.g. 84-024000-001" />
              </Field>
            ) : (
              <>
                <Field label="Guest Full Name *">
                  <input style={fs.input} value={form.guestFullName}
                    onChange={(e) => set('guestFullName', e.target.value)} />
                </Field>
                <TwoCol>
                  <Field label="Guest ID Number *">
                    <input style={fs.input} value={form.guestIdNumber}
                      onChange={(e) => set('guestIdNumber', e.target.value)} />
                  </Field>
                  <Field label="Guest Contact *">
                    <input style={fs.input} value={form.guestContactNumber}
                      onChange={(e) => set('guestContactNumber', e.target.value)} />
                  </Field>
                </TwoCol>
              </>
            )}

            <TwoCol>
              <Field label="Equipment Type ID *" hint="Numeric ID from inventory">
                <input style={fs.input} type="number" min={1} value={form.equipmentTypeId}
                  onChange={(e) => set('equipmentTypeId', e.target.value)} />
              </Field>
              <Field label="Article UUID(s) *" hint="Comma-separated">
                <input style={fs.input} value={form.articleIds}
                  onChange={(e) => set('articleIds', e.target.value)}
                  placeholder="uuid, uuid" />
              </Field>
            </TwoCol>
            <TwoCol>
              <Field label="Agreed Start * (actual event time)">
                <input style={fs.input} type="datetime-local" value={toLocal(form.agreedStartAt)}
                  onChange={(e) => set('agreedStartAt', toIso(e.target.value))} />
              </Field>
              <Field label="Agreed Return * (actual event time)">
                <input style={fs.input} type="datetime-local" value={toLocal(form.agreedReturnAt)}
                  onChange={(e) => set('agreedReturnAt', toIso(e.target.value))} />
              </Field>
            </TwoCol>
          </div>
        )}

        {/* ── RETURN ── */}
        {form.kind === 'RETURN' && (
          <div style={s.section}>
            <h3 style={s.sectionTitle}>Equipment Return</h3>
            <Field label="Borrow Transaction ID *" hint="UUID of the active borrow transaction">
              <input style={fs.input} value={form.borrowTxnId}
                onChange={(e) => set('borrowTxnId', e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </Field>
            <Field label="Article UUID(s) *" hint="Comma-separated UUIDs being returned">
              <input style={fs.input} value={form.returnArticleIds}
                onChange={(e) => set('returnArticleIds', e.target.value)}
                placeholder="uuid, uuid" />
            </Field>
            <TwoCol>
              <Field label="Actual Return Time * (from paper log)">
                <input style={fs.input} type="datetime-local" value={toLocal(form.returnedAt)}
                  onChange={(e) => set('returnedAt', toIso(e.target.value))} />
              </Field>
              <Field label="Return Condition *">
                <select style={{ ...fs.input, appearance: 'auto' }} value={form.condition}
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
        <div style={s.section}>
          <Field label="Note (optional)" hint="Paper log page/entry reference, coordinator remarks">
            <input style={fs.input} value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="e.g. Paper log p.3 entry #7" />
          </Field>
        </div>

        {error   && <div style={s.error}>{error}</div>}
        {success && <div style={s.success}>{success}</div>}

        <PrimaryButton onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Syncing…' : `Sync ${form.kind === 'BOOKING' ? 'Booking' : form.kind === 'BORROW' ? 'Borrow' : 'Return'} Entry`}
        </PrimaryButton>

        <p style={s.hint}>
          Entries are validated with the same conflict and inventory rules as live transactions.
          If an entry is rejected, resolve the discrepancy from the paper log before re-submitting (OFFL-06/07).
        </p>

        {/* Audit log panel */}
        <div style={{ ...s.section, marginTop: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ ...s.sectionTitle, margin: 0 }}>Fallback Entry Audit Log</h3>
            <button style={s.loadBtn} onClick={loadAudit} disabled={loadingAudit}>
              {loadingAudit ? 'Loading…' : 'Load Audit Log'}
            </button>
          </div>
          {auditLog === null && (
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
              Click "Load Audit Log" to view all fallback entries (OFFL-15/17).
            </p>
          )}
          {auditLog !== null && auditLog.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: '#6b7280' }}>No fallback entries recorded yet.</p>
          )}
          {auditLog !== null && auditLog.length > 0 && (
            <table style={s.table}>
              <thead>
                <tr>
                  {['Entered At', 'Type', 'Entered By', 'Role', 'Note'].map((h) => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditLog.map((e) => (
                  <tr key={e.audit_id}>
                    <td style={s.td}>{new Date(e.entered_at).toLocaleString()}</td>
                    <td style={s.td}><span style={{ ...s.badge, ...kindBadge(e.transaction_kind) }}>{e.transaction_kind}</span></td>
                    <td style={s.td}>{e.entered_by_name}</td>
                    <td style={s.td}>{e.entered_by_role}</td>
                    <td style={{ ...s.td, color: '#6b7280', fontSize: 12 }}>{e.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </PortalShell>
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

function kindBadge(k: string): React.CSSProperties {
  if (k === 'BOOKING') return { background: '#dbeafe', color: '#1e40af' };
  if (k === 'BORROW')  return { background: '#dcfce7', color: '#166534' };
  return { background: '#fef9c3', color: '#854d0e' };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={fs.label}>{label}</label>
      {hint && <p style={{ margin: '0 0 4px', fontSize: 12, color: '#6b7280' }}>{hint}</p>}
      {children}
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{children}</div>;
}

// ── Styles ──

const s = {
  banner: {
    background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 6,
    padding: '14px 18px', marginBottom: 24, color: '#713f00', fontSize: 14, lineHeight: 1.5,
  } as React.CSSProperties,
  section: {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6,
    padding: '20px 22px', marginBottom: 18,
  } as React.CSSProperties,
  sectionTitle: {
    margin: '0 0 18px', fontSize: 15, fontWeight: 700, color: '#374151',
  } as React.CSSProperties,
  tab: {
    padding: '7px 18px', border: '1px solid #d1d5db', borderRadius: 4,
    background: '#f9fafb', color: '#374151', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  } as React.CSSProperties,
  tabActive: {
    background: '#0a5c8f', color: '#fff', borderColor: '#0a5c8f',
  } as React.CSSProperties,
  error: {
    background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 4,
    padding: '10px 14px', marginBottom: 14, color: '#b91c1c', fontSize: 14,
  } as React.CSSProperties,
  success: {
    background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 4,
    padding: '10px 14px', marginBottom: 14, color: '#15803d', fontSize: 14,
  } as React.CSSProperties,
  hint: {
    marginTop: 12, fontSize: 12, color: '#6b7280', lineHeight: 1.6,
  } as React.CSSProperties,
  loadBtn: {
    padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 4,
    background: '#f3f4f6', color: '#374151', cursor: 'pointer', fontSize: 13,
  } as React.CSSProperties,
  table: {
    width: '100%', borderCollapse: 'collapse' as const, fontSize: 13,
  } as React.CSSProperties,
  th: {
    textAlign: 'left' as const, padding: '8px 10px', borderBottom: '2px solid #e5e7eb',
    fontWeight: 700, color: '#374151', fontSize: 12,
  } as React.CSSProperties,
  td: {
    padding: '8px 10px', borderBottom: '1px solid #f3f4f6', color: '#1f2937',
    verticalAlign: 'top' as const,
  } as React.CSSProperties,
  badge: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 700,
  } as React.CSSProperties,
};
