/**
 * Super Admin — Venue Approvals (VENUE-18..27, CONF-08/15) + Venue Management.
 *
 * Two panels:
 *   1. Forwarded queue — approve / reject / return to Coordinator
 *   2. Venues — full CRUD: create, edit (all fields), delete, availability status
 */
import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import {
  listAdminQueue, approveBooking, rejectBooking, returnForReeval,
  listVenues, createVenue, updateVenue, deleteVenue, getBookingFull,
  type AdminQueueBooking, type Venue, type VenueAvailabilityStatus, SURFACE_TYPES,
} from './api.js';
import { listSportCategories, type SportCategory } from '../inventory/api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

const AVAIL_LABEL: Record<VenueAvailabilityStatus, string> = {
  AVAILABLE: 'Available',
  UNDER_MAINTENANCE: 'Under Maintenance',
  CLOSED: 'Closed',
};
const AVAIL_STYLE: Record<VenueAvailabilityStatus, React.CSSProperties> = {
  AVAILABLE: { background: '#e6f4ec', color: '#1f7a45' },
  UNDER_MAINTENANCE: { background: '#fdf1e3', color: '#9a6412' },
  CLOSED: { background: '#fdecec', color: '#8f2323' },
};

export default function VenueApprovalScreen() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = useState<AdminQueueBooking[] | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [selected, setSelected] = useState<AdminQueueBooking | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [viewingVenue, setViewingVenue] = useState<Venue | null>(null);
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

  const flash = {
    ok: (m: string) => { setNotice(m); setError(null); },
    err: (m: string) => { setError(m); setNotice(null); },
  };

  async function confirmDelete() {
    if (!deletingId) return;
    try {
      const res = await deleteVenue(deletingId);
      flash.ok(res.message);
      setDeletingId(null);
      void load();
    } catch (e) { flash.err(errMsg(e)); setDeletingId(null); }
  }

  const deletingVenue = venues.find((v) => v.venue_id === deletingId);

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
            {/* ── Approval queue ── */}
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

            {/* ── Venues ── */}
            <Panel title="Venues" action={
              <button style={ghostBtn} onClick={() => { setShowForm((v) => !v); setEditingId(null); }}>
                {showForm ? 'Close' : 'Add Venue'}
              </button>
            }>
              {showForm && (
                <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid #e5e5e5' }}>
                  <VenueForm cats={cats}
                    onDone={(m) => { flash.ok(m); setShowForm(false); void load(); }}
                    onError={flash.err} />
                </div>
              )}

              {venues.length === 0 ? <p style={muted}>No venues yet.</p> : (
                <table style={table}>
                  <thead>
                    <tr>
                      <th style={th}>Name</th>
                      <th style={th}>Sports</th>
                      <th style={th}>Cap.</th>
                      <th style={th}>Setting</th>
                      <th style={th}>Status</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {venues.map((v) => (
                      <Fragment key={v.venue_id}>
                        <tr>
                          <td style={td}>
                            <div style={{ fontWeight: 600 }}>{v.name}</div>
                            {v.location && <div style={{ fontSize: 12, color: '#5c6773', marginTop: 2 }}>{v.location}</div>}
                          </td>
                          <td style={td}>
                            {v.sports.length === 0 ? <span style={{ color: '#8a949f' }}>—</span>
                              : v.sports.map((s) => s.sport_name).join(', ')}
                          </td>
                          <td style={td}>{v.capacity}</td>
                          <td style={td}>{v.is_indoor ? 'Indoor' : 'Outdoor'}</td>
                          <td style={td}>
                            <span style={{ ...badge, ...AVAIL_STYLE[v.availability_status] }}>
                              {AVAIL_LABEL[v.availability_status]}
                            </span>
                          </td>
                          <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button style={linkBtn} onClick={() => setViewingVenue(v)}>View</button>
                            <button style={linkBtn} onClick={() => setEditingId(editingId === v.venue_id ? null : v.venue_id)}>
                              {editingId === v.venue_id ? 'Cancel' : 'Edit'}
                            </button>
                            <button style={{ ...linkBtn, color: 'var(--danger, #c0392b)' }} onClick={() => setDeletingId(v.venue_id)}>
                              Delete
                            </button>
                          </td>
                        </tr>

                        {/* Photos row */}
                        {v.photos.length > 0 && editingId !== v.venue_id && (
                          <tr>
                            <td colSpan={6} style={{ ...td, paddingTop: 0, paddingBottom: 10 }}>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {v.photos.map((p, i) => (
                                  <img key={i} src={p} alt={`${v.name} photo ${i + 1}`}
                                    style={{ width: 80, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid #e5e5e5' }} />
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Inline edit form */}
                        {editingId === v.venue_id && (
                          <tr>
                            <td colSpan={6} style={{ ...td, background: '#f8f9fa' }}>
                              <VenueForm cats={cats} editing={v}
                                onDone={(m) => { flash.ok(m); setEditingId(null); void load(); }}
                                onError={flash.err}
                                onCancel={() => setEditingId(null)} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </>
        )}

        {viewingVenue && <VenueDetailModal venue={viewingVenue} onClose={() => setViewingVenue(null)} />}

        {/* Delete confirmation */}
        {deletingId != null && (
          <div style={overlay}>
            <div style={dialog}>
              <h3 style={{ margin: '0 0 10px', fontSize: 17 }}>Delete Venue</h3>
              <p style={{ margin: '0 0 16px', fontSize: 14, color: '#555' }}>
                Delete <strong>{deletingVenue?.name}</strong>?
                {' '}If it has historical bookings it will be deactivated rather than removed.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={rejectBtn} onClick={confirmDelete}>Delete</button>
                <button style={ghostBtn} onClick={() => setDeletingId(null)}>Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  );
}

// ── Decision panel ──
function DecisionPanel({ item, onBack, onDone, onError }: {
  item: AdminQueueBooking; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [mode, setMode] = useState<'none' | 'reject' | 'return'>('none');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<import('./api.js').BookingDetailFull | null>(null);

  useEffect(() => {
    getBookingFull(item.booking_id).then(setDetail).catch(() => {});
  }, [item.booking_id]);

  const meta = detail?.booking_metadata as Record<string, unknown> | null | undefined;
  const proposedSessions = detail?.coordinator_proposed_sessions;

  async function approve() {
    setBusy(true);
    try { await approveBooking(item.booking_id); onDone(`Booking approved for ${item.requester_name}.`); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function reject() {
    if (!text.trim()) { onError('Rejection reason required.'); return; }
    setBusy(true);
    try { await rejectBooking(item.booking_id, text); onDone('Booking rejected.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }
  async function returnIt() {
    if (!text.trim()) { onError('Note for coordinator required.'); return; }
    setBusy(true);
    try { await returnForReeval(item.booking_id, text); onDone('Returned to the Coordinator.'); }
    catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Panel title={`Decide — ${item.requester_name ?? 'BUKC Sports Dept.'}`}>
      {/* Core fields */}
      <Row label="Venue" value={item.venue_name} />
      <Row label="Purpose" value={item.purpose} />
      <Row label="Participants" value={String(item.estimated_participants)} />
      <Row label="Sessions" value={`${item.sessionCount}${item.firstStart ? ` · from ${new Date(item.firstStart).toLocaleDateString()}` : ''}`} />
      <Row label="Forwarded at" value={item.forwarded_at ? new Date(item.forwarded_at).toLocaleString() : '—'} />
      <Row label="Coordinator's note" value={item.feasibility_note ?? '—'} />

      {/* Coordinator's proposed schedule (if any) */}
      {proposedSessions && proposedSessions.length > 0 && (
        <div style={{ margin: '12px 0', padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6 }}>
          <div style={{ font: '600 12px var(--font-body)', color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Coordinator proposed alternative schedule</div>
          {proposedSessions.map((s) => (
            <div key={s.sessionNo} style={{ fontSize: 13.5, color: '#1e3a8a', marginBottom: 3 }}>
              Session {s.sessionNo}: {new Date(s.startAt).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })} · {new Date(s.startAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}–{new Date(s.endAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
            </div>
          ))}
        </div>
      )}

      {/* Pitch metadata summary */}
      {meta && (
        <div style={{ margin: '12px 0', padding: '10px 14px', background: '#f7f9fb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
          <div style={{ font: '600 12px var(--font-body)', color: '#26485f', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Booking Pitch Details</div>
          <div style={{ display: 'grid', gap: 5 }}>
            {([
              ['Type', meta.bookingType === 'INTER_UNIVERSITY' ? 'Inter-University' : 'Internal Competition'],
              ['Sport', String(meta.sport ?? '—')],
              ['Format', `${String(meta.eventFormat ?? '').replace('_', ' ')} · ${String(meta.matchFormat ?? '').replace('_', ' ')}`],
              ...(meta.bookingType === 'INTER_UNIVERSITY'
                ? [['BUKC team', String(meta.bukcTeamName ?? '—')], ['Visiting team', `${meta.visitingTeamName ?? '—'} — ${meta.visitingUniversity ?? '—'}`]]
                : [['Team A', String(meta.teamAName ?? '—')], ['Team B', String(meta.teamBName ?? '—')]]),
              ['Equipment', meta.equipmentSupport === 'UNIVERSITY' ? 'University support required' : 'Teams supply own'],
              ...((meta.equipmentItems as Array<{ name: string; quantity: number }> | undefined ?? []).length > 0
                ? [['Requested eq.', (meta.equipmentItems as Array<{ name: string; quantity: number }>).map((e) => `${e.name} ×${e.quantity}`).join(', ')]]
                : []),
            ] as Array<[string, string]>).map(([k, v]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', fontSize: 13.5 }}>
                <span style={{ font: '600 11px var(--font-body)', color: '#5c6773', textTransform: 'uppercase', letterSpacing: '0.03em', paddingTop: 2 }}>{k}</span>
                <span style={{ color: '#333' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'none' && (
        <div style={actionRow}>
          <button style={acceptBtn} disabled={busy} onClick={approve}>✓ Approve</button>
          <button style={rejectBtn} onClick={() => setMode('reject')}>Reject…</button>
          <button style={ghostBtn} onClick={() => setMode('return')}>Return to Coordinator…</button>
          <button style={ghostBtn} onClick={onBack}>Back</button>
        </div>
      )}
      {mode !== 'none' && (
        <div style={{ marginTop: 14 }}>
          <label style={lbl}>{mode === 'reject' ? 'Rejection reason (shown to requester)' : 'Note for the Coordinator'}</label>
          <textarea style={textarea} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <div style={actionRow}>
            <button style={mode === 'reject' ? rejectBtn : acceptBtn} disabled={!text.trim() || busy}
              onClick={mode === 'reject' ? reject : returnIt}>
              {mode === 'reject' ? 'Confirm rejection' : 'Return to Coordinator'}
            </button>
            <button style={ghostBtn} onClick={() => setMode('none')}>Cancel</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Venue form (create + edit) ──
function VenueForm({ cats, editing, onDone, onError, onCancel }: {
  cats: SportCategory[];
  editing?: Venue;
  onDone: (m: string) => void;
  onError: (m: string) => void;
  onCancel?: () => void;
}) {
  const isEdit = Boolean(editing);
  const [name, setName] = useState(editing?.name ?? '');
  const [capacity, setCapacity] = useState<string>(String(editing?.capacity ?? 30));
  const [isIndoor, setIndoor] = useState(editing?.is_indoor ?? true);
  const [sportCategoryIds, setSports] = useState<number[]>(editing?.sports.map((s) => s.sport_category_id) ?? []);
  const [description, setDescription] = useState(editing?.description ?? '');
  const [location, setLocation] = useState(editing?.location ?? '');
  const [surfaceType, setSurface] = useState(editing?.surface_type ?? '');
  const [availabilityStatus, setAvailStatus] = useState<VenueAvailabilityStatus>(editing?.availability_status ?? 'AVAILABLE');
  const [photos, setPhotos] = useState<string[]>(editing?.photos ?? []);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Per-field validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function toggleSport(id: number) {
    setSports((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
    setFieldErrors((prev) => ({ ...prev, sports: '' }));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2) errs.name = 'Venue name is required (min 2 characters).';
    const cap = Number(capacity);
    if (!capacity || isNaN(cap) || cap < 1 || !Number.isInteger(cap)) errs.capacity = 'Capacity must be a whole number of at least 1.';
    if (sportCategoryIds.length === 0) errs.sports = 'Select at least one sport.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const remaining = 3 - photos.length;
    if (remaining <= 0) { onError('Maximum 3 photos per venue.'); return; }
    files.slice(0, remaining).forEach((file) => {
      if (!file.type.startsWith('image/')) { onError('Only image files are accepted.'); return; }
      if (file.size > 400_000) { onError(`${file.name} is too large — max 400 KB per photo.`); return; }
      const reader = new FileReader();
      reader.onload = () => setPhotos((prev) => [...prev, reader.result as string].slice(0, 3));
      reader.readAsDataURL(file);
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        capacity: Number(capacity),
        isIndoor,
        sportCategoryIds,
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        surfaceType: surfaceType || undefined,
        photos,
      };
      if (isEdit && editing) {
        await updateVenue(editing.venue_id, { ...payload, availabilityStatus });
        onDone('Venue updated.');
      } else {
        await createVenue(payload);
        onDone('Venue added.');
      }
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  const fieldInp = (hasErr: boolean): React.CSSProperties => ({
    ...inp,
    ...(hasErr ? { borderColor: '#c0392b', background: '#fff8f8' } : {}),
  });

  return (
    <form onSubmit={submit}>
      <div style={formGrid}>
        {/* Name */}
        <L label="Venue name *">
          <input style={fieldInp(!!fieldErrors.name)} value={name}
            onChange={(e) => { setName(e.target.value); setFieldErrors((p) => ({ ...p, name: '' })); }}
            placeholder="e.g. Main Sports Hall" />
          {fieldErrors.name && <span style={fieldErr}>{fieldErrors.name}</span>}
        </L>

        {/* Location */}
        <L label="Building / Location *">
          <input style={inp} value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Sports Block, Ground Floor" />
        </L>

        {/* Capacity */}
        <L label="Capacity *">
          <input type="number" min={1} step={1} style={fieldInp(!!fieldErrors.capacity)}
            value={capacity} onChange={(e) => { setCapacity(e.target.value); setFieldErrors((p) => ({ ...p, capacity: '' })); }} />
          {fieldErrors.capacity && <span style={fieldErr}>{fieldErrors.capacity}</span>}
        </L>

        {/* Setting */}
        <L label="Setting *">
          <select style={inp} value={isIndoor ? '1' : '0'} onChange={(e) => setIndoor(e.target.value === '1')}>
            <option value="1">Indoor</option>
            <option value="0">Outdoor</option>
          </select>
        </L>

        {/* Surface type */}
        <L label="Surface type *">
          <select style={inp} value={surfaceType} onChange={(e) => setSurface(e.target.value)}>
            <option value="">— Not specified —</option>
            {SURFACE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </L>

        {/* Availability status (edit only) */}
        {isEdit && (
          <L label="Availability status *">
            <select style={inp} value={availabilityStatus} onChange={(e) => setAvailStatus(e.target.value as VenueAvailabilityStatus)}>
              <option value="AVAILABLE">Available</option>
              <option value="UNDER_MAINTENANCE">Under Maintenance</option>
              <option value="CLOSED">Closed</option>
            </select>
          </L>
        )}

        {/* Description — full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <L label="Description">
            <textarea style={{ ...inp, resize: 'vertical', minHeight: 64 }} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes — surface condition, markings, facilities…" maxLength={500} />
            <span style={{ fontSize: 11, color: '#8a949f' }}>{description.length}/500</span>
          </L>
        </div>

        {/* Sports — required, full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <span style={{ ...lbl, ...(fieldErrors.sports ? { color: '#c0392b' } : {}) }}>
            Sports * (select all that apply)
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 6, padding: fieldErrors.sports ? '8px' : 0, borderRadius: 4, border: fieldErrors.sports ? '1px solid #c0392b' : 'none', background: fieldErrors.sports ? '#fff8f8' : 'transparent' }}>
            {cats.map((c) => (
              <label key={c.sport_category_id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 14 }}>
                <input type="checkbox" checked={sportCategoryIds.includes(c.sport_category_id)}
                  onChange={() => toggleSport(c.sport_category_id)} />
                {c.name}
              </label>
            ))}
          </div>
          {fieldErrors.sports && <span style={fieldErr}>{fieldErrors.sports}</span>}
        </div>

        {/* Photos — full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <span style={lbl}>Photos (up to 3, max 400 KB each)</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-start' }}>
            {photos.map((p, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={p} alt={`Photo ${i + 1}`} style={{ width: 100, height: 70, objectFit: 'cover', borderRadius: 6, border: '1px solid #ddd', display: 'block' }} />
                <button type="button"
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: '#c0392b', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {photos.length < 3 && (
              <button type="button" onClick={() => fileRef.current?.click()}
                style={{ width: 100, height: 70, border: '2px dashed #ccc', borderRadius: 6, background: '#f8f9fa', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#8a949f', fontSize: 12 }}>
                <span style={{ fontSize: 22 }}>+</span>Add photo
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handlePhotoUpload} />
          </div>
        </div>

        {/* Actions */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, marginTop: 4 }}>
          <button style={acceptBtn} disabled={busy}>{busy ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save Changes' : 'Add Venue')}</button>
          {onCancel && <button type="button" style={ghostBtn} onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </form>
  );
}

// ── Venue Detail Modal ──
function VenueDetailModal({ venue, onClose }: { venue: Venue; onClose: () => void }) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...dialog, maxWidth: 560, width: '94%' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#26485f' }}>{venue.name}</h2>
            {venue.location && <div style={{ fontSize: 13, color: '#5c6773', marginTop: 3 }}>{venue.location}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#8a949f', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        {/* Availability badge */}
        <div style={{ marginBottom: 14 }}>
          <span style={{ ...badge, ...AVAIL_STYLE[venue.availability_status], fontSize: 13, padding: '4px 12px' }}>
            {AVAIL_LABEL[venue.availability_status]}
          </span>
        </div>

        {/* Core details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', marginBottom: 16 }}>
          <DetailField label="Capacity" value={String(venue.capacity)} />
          <DetailField label="Setting" value={venue.is_indoor ? 'Indoor' : 'Outdoor'} />
          <DetailField label="Surface" value={venue.surface_type ?? '—'} />
          <DetailField label="Sports" value={venue.sports.length > 0 ? venue.sports.map((s) => s.sport_name).join(', ') : '—'} />
        </div>

        {/* Description */}
        {venue.description && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ font: '600 11px var(--font-body)', color: '#8a949f', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Description</div>
            <div style={{ fontSize: 14, color: '#444', lineHeight: 1.5 }}>{venue.description}</div>
          </div>
        )}

        {/* Photos */}
        {venue.photos.length > 0 && (
          <div>
            <div style={{ font: '600 11px var(--font-body)', color: '#8a949f', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Photos</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {venue.photos.map((p, i) => (
                <img key={i} src={p} alt={`${venue.name} ${i + 1}`}
                  style={{ width: 150, height: 100, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e5e5' }} />
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'flex-end' }}>
          <button style={ghostBtn} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ font: '600 11px var(--font-body)', color: '#8a949f', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#333' }}>{value}</div>
    </div>
  );
}

// ── Shared components ──
function Row({ label, value }: { label: string; value: string }) {
  return <div style={detailRow}><div style={detailLabel}>{label}</div><div>{value}</div></div>;
}
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={panel}>
      <div style={panelHead}><span>{title}</span>{action}</div>
      <div style={panelBody}>{children}</div>
    </section>
  );
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

// ── Styles ──
const wrap: React.CSSProperties = { maxWidth: 920, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 6, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)', borderRadius: '6px 6px 0 0' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '11px 8px', borderBottom: '1px solid #eee', color: '#333', verticalAlign: 'top' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' };
const textarea: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, maxWidth: 680 };
const badge: React.CSSProperties = { display: 'inline-block', font: '600 11px var(--font-mono)', padding: '2px 8px', borderRadius: 4 };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', font: '500 13px var(--font-body)', color: '#0a6ebd', cursor: 'pointer', padding: '4px 8px' };
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
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const dialog: React.CSSProperties = { background: '#fff', borderRadius: 8, padding: '24px 28px', maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' };
const fieldErr: React.CSSProperties = { display: 'block', fontSize: 12, color: '#c0392b', marginTop: 4 };
