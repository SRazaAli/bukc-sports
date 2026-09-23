/**
 * Super Admin — Venue Approvals (VENUE-18..27, CONF-08/15) + Venue Management.
 *
 * Two panels:
 *   1. Forwarded queue — approve / reject / return to Coordinator
 *   2. Venues — full CRUD: create, edit (all fields), delete, availability status
 *
 * Re-themed to the site's navy + glassmorphism language (same header, page
 * background, glow blobs, frosted glass shell and Inter type as the Accounts
 * screen). Clicking "Add Venue" switches to a two-column layout — venue form
 * on the left, guidelines on the right, the searchable venue list below —
 * rendered as dark navy glass cards.
 * Frontend only — no API/route/validation/logic changes.
 */
import { useEffect, useState, useCallback, useRef, Fragment, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import {
  listAdminQueue, approveBooking, rejectBooking, returnForReeval,
  listVenues, createVenue, updateVenue, deleteVenue, getBookingFull,
  type AdminQueueBooking, type Venue, type VenueAvailabilityStatus, SURFACE_TYPES,
} from './api.js';
import { listSportCategories, type SportCategory } from '../inventory/api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

/* ---------- theme (same values as AdminAccountsScreen / UsageHistoryScreen `palette`) ---------- */
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

const AVAIL_LABEL: Record<VenueAvailabilityStatus, string> = {
  AVAILABLE: 'Available',
  UNDER_MAINTENANCE: 'Under Maintenance',
  CLOSED: 'Closed',
};
const AVAIL_STYLE: Record<VenueAvailabilityStatus, React.CSSProperties> = {
  AVAILABLE: { background: '#E6F4EC', color: '#1F7A45' },
  UNDER_MAINTENANCE: { background: '#FDF1E3', color: '#9A6412' },
  CLOSED: { background: '#FDECEC', color: '#B3352B' },
};

export default function VenueApprovalScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<AdminQueueBooking[] | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [venuesLoaded, setVenuesLoaded] = useState(false);
  const [cats, setCats] = useState<SportCategory[]>([]);
  const [selected, setSelected] = useState<AdminQueueBooking | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [viewingVenue, setViewingVenue] = useState<Venue | null>(null);
  const [venueSearch, setVenueSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [q, v, c] = await Promise.all([listAdminQueue(), listVenues(), listSportCategories()]);
      setQueue(q.queue); setVenues(v.venues); setCats(c.categories);
    } catch (e) { setError(errMsg(e)); }
    finally { setVenuesLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const header = (
    <header style={s.topbar}>
      <div style={s.brand}>
        <img src="/landing/bu_logo.png" alt="Bahria University" style={s.logoImg} />
        <div>
          <div style={s.wordmark}>Bahria University</div>
          <div style={s.wordmarkSub}>Sports Management Portal</div>
        </div>
      </div>
      <div style={s.topbarRight}>
        <Link to="/home" className="va-topbtn" style={s.topBtn}><BackIcon /> Back</Link>
        <button type="button" className="va-topbtn va-signout" style={s.topBtn} onClick={() => { void logout(); navigate('/'); }}>
          <SignOutIcon /> Sign out
        </button>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="va-ui" style={s.page}>
        <VaStyles />
        {header}
        <main style={s.main}><div className="va-glass" style={s.glassPanel}><SkeletonRows rows={4} /></div></main>
      </div>
    );
  }
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

  // Presentation-only filter over the already-loaded venue list.
  const term = venueSearch.trim().toLowerCase();
  const filteredVenues = term
    ? venues.filter((v) =>
      v.name.toLowerCase().includes(term)
      || (v.location ?? '').toLowerCase().includes(term)
      || v.sports.some((sp) => sp.sport_name.toLowerCase().includes(term))
      || AVAIL_LABEL[v.availability_status].toLowerCase().includes(term)
      || (v.is_indoor ? 'indoor' : 'outdoor').includes(term))
    : venues;

  const availableCount = venues.filter((v) => v.availability_status === 'AVAILABLE').length;
  const offlineCount = venues.length - availableCount;

  const venuesPanel = (
    <Panel
      title={showForm ? 'All Venues' : 'Venues'}
      icon={<ListBoxIcon />}
      action={
        <div style={s.panelActions}>
          <div style={s.searchBox}>
            <span style={s.searchIcon}><SearchIcon /></span>
            <input type="search" className="va-input" style={s.searchInput} value={venueSearch}
              onChange={(e) => setVenueSearch(e.target.value)} placeholder="Search venues…" aria-label="Search venues" />
          </div>
          {!showForm && (
            <button type="button" className="va-btn" style={s.primarySmBtn}
              onClick={() => { setShowForm(true); setEditingId(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <PlusIcon /> Add Venue
            </button>
          )}
        </div>
      }
    >
      {!venuesLoaded ? <SkeletonRows rows={3} /> : venues.length === 0 ? (
        <EmptyState icon={<BuildingIcon />} text="No venues yet. Add your first venue to start accepting bookings." />
      ) : filteredVenues.length === 0 ? (
        <EmptyState icon={<SearchIcon />} text={`No venues match "${venueSearch.trim()}".`}
          action={{ label: 'Clear search', onClick: () => setVenueSearch('') }} />
      ) : (
        <>
          <div className="va-table-wrap" style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr style={s.theadRow}>
                  <th style={s.th}>Name</th>
                  <th style={s.th}>Sports</th>
                  <th style={s.th}>Cap.</th>
                  <th className="va-hide-mobile" style={s.th}>Setting</th>
                  <th style={s.th}>Status</th>
                  <th className="va-hide-mobile" style={s.th}>Note</th>
                  <th style={{ ...s.th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVenues.map((v, i) => (
                  <Fragment key={v.venue_id}>
                    <tr className="va-row va-row-anim" style={{ animationDelay: `${i * 30}ms` }}>
                      <td style={s.td}>
                        <div style={s.nameText}>{v.name}</div>
                        {v.location && <div style={s.subText}>{v.location}</div>}
                      </td>
                      <td style={s.td}>
                        {v.sports.length === 0 ? <span style={{ color: palette.slate500 }}>—</span>
                          : v.sports.map((sp) => sp.sport_name).join(', ')}
                      </td>
                      <td style={s.td}>{v.capacity}</td>
                      <td className="va-hide-mobile" style={s.td}>{v.is_indoor ? 'Indoor' : 'Outdoor'}</td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, ...AVAIL_STYLE[v.availability_status] }}>
                          {AVAIL_LABEL[v.availability_status]}
                        </span>
                      </td>
                      <td className="va-hide-mobile" style={{ ...s.td, maxWidth: 200 }}>
                        {v.description
                          ? <span style={s.noteText} title={v.description}>{v.description}</span>
                          : <span style={{ color: palette.slate500 }}>—</span>}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="va-btn va-link" style={s.linkBtn} onClick={() => setViewingVenue(v)}>View</button>
                        <button className="va-btn va-link" style={s.linkBtn} onClick={() => setEditingId(editingId === v.venue_id ? null : v.venue_id)}>
                          {editingId === v.venue_id ? 'Cancel' : 'Edit'}
                        </button>
                        <button className="va-btn va-link" style={{ ...s.linkBtn, color: '#C0392B' }} onClick={() => setDeletingId(v.venue_id)}>
                          Delete
                        </button>
                      </td>
                    </tr>

                    {/* Photos row */}
                    {v.photos.length > 0 && editingId !== v.venue_id && (
                      <tr>
                        <td colSpan={7} style={{ ...s.td, borderTop: 'none', paddingTop: 0, paddingBottom: 12 }}>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {v.photos.map((p, j) => (
                              <img key={j} src={p} alt={`${v.name} photo ${j + 1}`} style={s.thumb} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Inline edit form */}
                    {editingId === v.venue_id && (
                      <tr>
                        <td colSpan={7} style={{ ...s.td, background: '#F1F5FD', padding: '18px 16px' }}>
                          <div style={s.editHead}><EditIcon /> Editing <strong style={{ color: palette.navy900 }}>{v.name}</strong></div>
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
          </div>
          <div style={s.tableFoot}>
            Showing {filteredVenues.length}{term ? ` of ${venues.length}` : ''} venue{filteredVenues.length !== 1 ? 's' : ''}
          </div>
        </>
      )}
    </Panel>
  );

  return (
    <div className="va-ui" style={s.page}>
      <VaStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />

      {header}

      <main style={s.main}>
        <div className="va-glass" style={s.glassPanel}>
          <div style={s.hero}>
            <span style={s.heroEyebrow}><ShieldIcon /> Administration Staff</span>
            <h1 style={s.heroTitle}>Venue Approvals</h1>
            <p style={s.heroSubtitle}>
              {showForm
                ? 'Add a new venue to the campus booking system, or manage the ones already listed.'
                : 'Decide on bookings forwarded by the Coordinator and manage every venue across campus.'}
            </p>
          </div>

          {error && <div className="va-toast" style={s.banner.error}><AlertIcon /> {error}</div>}
          {notice && <div className="va-toast" style={s.banner.ok}><CheckCircleIcon /> {notice}</div>}

          {selected ? (
            <DecisionPanel item={selected} onBack={() => setSelected(null)}
              onDone={(m) => { flash.ok(m); setSelected(null); void load(); }} onError={flash.err} />
          ) : showForm ? (
            <>
              {/* ── Add Venue layout: form + guidelines, list below ── */}
              <div className="va-add-grid" style={s.addGrid}>
                <section className="va-card" style={{ ...s.card, marginBottom: 0 }}>
                  <div style={s.formHead}>
                    <span style={s.formHeadIcon}><BuildingIcon size={20} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.formHeadTitle}>Add New Venue</div>
                      <div style={s.formHeadSub}>Fill in the details below to add a venue for events and sports activities.</div>
                    </div>
                    <button type="button" className="va-btn va-icon-btn" style={s.closeIconBtn}
                      onClick={() => { setShowForm(false); setEditingId(null); }} aria-label="Close add venue form" title="Close">
                      <XIcon />
                    </button>
                  </div>
                  <div style={{ padding: '0 24px 24px' }}>
                    <VenueForm cats={cats}
                      onDone={(m) => { flash.ok(m); setShowForm(false); void load(); }}
                      onError={flash.err}
                      onCancel={() => setShowForm(false)} />
                  </div>
                </section>

                <aside className="va-card" style={{ ...s.card, marginBottom: 0 }}>
                  <div style={s.formHead}>
                    <span style={s.formHeadIcon}><DocIcon /></span>
                    <div style={s.formHeadTitle}>Venue Guidelines</div>
                  </div>
                  <div style={{ padding: '0 24px 24px' }}>
                  <ul style={s.guideList}>
                    {[
                      'Provide accurate details about the venue and its capacity.',
                      'Select the correct setting (Indoor / Outdoor).',
                      'Choose the surface type if applicable.',
                      'Tick every sport the venue can host.',
                      'Add relevant photos so requesters know what to expect.',
                    ].map((g) => (
                      <li key={g} style={s.guideItem}><span style={s.guideTick}><TickIcon /></span>{g}</li>
                    ))}
                  </ul>
                  <div style={s.infoBox}>
                    <span style={{ color: palette.accent, display: 'inline-flex', marginTop: 1 }}><ClockIcon /></span>
                    <div>
                      <div style={s.infoTitle}>Listed right away</div>
                      <div style={s.infoText}>
                        New venues are marked Available as soon as they're added. Use Edit later to set them Under Maintenance or Closed.
                      </div>
                    </div>
                  </div>
                  </div>
                </aside>
              </div>

              <div style={{ height: 22 }} />
              {venuesPanel}
            </>
          ) : (
            <>
              <div style={s.statRow}>
                <StatCard label="Awaiting decision" value={queue?.length ?? 0} accent={palette.accent} icon={<InboxIcon />} />
                <StatCard label="Total venues" value={venues.length} accent="#6B21A8" icon={<BuildingIcon />} />
                <StatCard label="Available" value={availableCount} accent="#1F7A45" icon={<CheckCircleIcon />} />
                <StatCard label="Maintenance / closed" value={offlineCount} accent="#9A6412" icon={<AlertIcon />} />
              </div>

              {/* ── Approval queue ── */}
              <Panel title="Forwarded — Awaiting Your Decision" icon={<InboxIcon />}
                action={queue && queue.length > 0 ? <span style={s.countPill}>{queue.length} pending</span> : undefined}>
                {queue === null ? <SkeletonRows rows={3} /> : queue.length === 0 ? (
                  <EmptyState icon={<CheckCircleIcon />} text="Nothing forwarded right now. Bookings the Coordinator forwards will appear here." />
                ) : (
                  <div className="va-table-wrap" style={s.tableWrap}>
                    <table style={s.table}>
                      <thead><tr style={s.theadRow}><th style={s.th}>Requester</th><th style={s.th}>Venue</th><th style={s.th}>Window</th><th style={s.th} /></tr></thead>
                      <tbody>
                        {queue.map((q, i) => (
                          <tr key={q.booking_id} className="va-row va-row-anim" style={{ animationDelay: `${i * 35}ms` }}>
                            <td style={s.td}>
                              <div style={s.nameCell}>
                                <Avatar name={q.requester_name ?? 'BUKC Sports Dept.'} />
                                <span style={s.nameText}>{q.requester_name}</span>
                              </div>
                            </td>
                            <td style={s.td}>{q.venue_name}</td>
                            <td style={s.td}>{q.sessionCount} session{q.sessionCount !== 1 ? 's' : ''}{q.firstStart ? ` · from ${new Date(q.firstStart).toLocaleDateString()}` : ''}</td>
                            <td style={{ ...s.td, textAlign: 'right' }}>
                              <button className="va-btn" style={s.primarySmBtn} onClick={() => setSelected(q)}>Decide</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              {/* ── Venues ── */}
              {venuesPanel}
            </>
          )}
        </div>
      </main>

      <footer style={s.footer}>
        2026 © <a href="/" style={s.footerLink}>Bahria University</a> — Sports Management Portal
      </footer>

      {viewingVenue && <VenueDetailModal venue={viewingVenue} onClose={() => setViewingVenue(null)} />}

      {/* Delete confirmation */}
      {deletingId != null && (
        <Modal title="Delete Venue" onClose={() => setDeletingId(null)}>
          <p style={{ margin: '0 0 18px', fontSize: 14, color: palette.slate500, lineHeight: 1.55 }}>
            Delete <strong style={{ color: palette.navy900 }}>{deletingVenue?.name}</strong>?
            {' '}If it has historical bookings it will be deactivated rather than removed.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="va-btn" style={s.ghostBtn} onClick={() => setDeletingId(null)}>Cancel</button>
            <button className="va-btn" style={s.dangerBtn} onClick={confirmDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function VaStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .va-ui { font-family: 'Inter', system-ui, sans-serif; }
      .va-ui * { box-sizing: border-box; }
      .va-card { animation: vaFadeUp .45s ease both; }
      @keyframes vaFadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      .va-row { transition: background-color .15s ease; }
      .va-row:hover { background: ${palette.slate50}; }
      .va-row-anim { opacity: 0; animation: vaRowIn .35s ease forwards; }
      @keyframes vaRowIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
      .va-btn { transition: transform .15s ease, box-shadow .15s ease, filter .15s ease, background-color .15s ease, border-color .15s ease, color .15s ease; }
      .va-btn:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.04); }
      .va-btn:active:not(:disabled) { transform: translateY(0); }
      .va-btn:disabled { opacity: .55; cursor: not-allowed; }
      .va-link:hover { text-decoration: underline; text-underline-offset: 3px; }
      .va-icon-btn:hover { background: ${palette.accentWash} !important; color: ${palette.accent} !important; }
      .va-input { transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
      .va-input::placeholder { color: ${palette.slate400}; opacity: 1; }
      .va-input:hover { border-color: ${palette.slate400} !important; }
      .va-input:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 4px ${palette.accentSoft}; background-color: #fff !important; }
      .va-field:focus-within .va-field-icon { color: ${palette.accent}; }
      .va-chip { transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .1s ease; }
      .va-chip:hover { transform: translateY(-1px); border-color: ${palette.accent} !important; }
      .va-chip input { accent-color: ${palette.accent}; }
      .va-dropzone { transition: border-color .15s ease, background-color .15s ease, color .15s ease; }
      .va-dropzone:hover { border-color: ${palette.accent} !important; color: ${palette.accent} !important; background: ${palette.accentWash} !important; }
      .va-modal-anim { animation: vaPop .2s ease both; }
      @keyframes vaPop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .va-toast { animation: vaToast .3s ease both; }
      @keyframes vaToast { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      .va-stat { transition: transform .18s ease, box-shadow .18s ease; }
      .va-stat:hover { transform: translateY(-2px); box-shadow: 0 14px 26px -16px rgba(3,22,54,0.4); }
      .va-skel { position: relative; overflow: hidden; background: ${palette.slate300}; }
      .va-skel::after {
        content: ''; position: absolute; inset: 0; transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent);
        animation: vaShimmer 1.3s ease-in-out infinite;
      }
      @keyframes vaShimmer { 100% { transform: translateX(100%); } }
      .va-topbtn { transition: background-color .18s ease, border-color .18s ease, color .18s ease; text-decoration: none; }
      .va-topbtn:hover { background-color: rgba(255,255,255,0.08); border-color: ${palette.slate100}; }
      .va-signout:hover { background-color: ${palette.accent} !important; border-color: ${palette.accent} !important; color: #fff !important; }
      @media (max-width: 960px) {
        .va-add-grid { grid-template-columns: 1fr !important; }
      }
      @media (max-width: 720px) {
        .va-hide-mobile { display: none !important; }
        .va-form-grid { grid-template-columns: 1fr !important; }
        .va-glass { padding: 20px 14px 26px !important; border-radius: 18px !important; }
        .va-detail-grid { grid-template-columns: 1fr !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .va-card, .va-row-anim, .va-toast, .va-modal-anim { animation: none !important; opacity: 1 !important; }
      }
    `}</style>
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
    <Panel title={`Decide — ${item.requester_name ?? 'BUKC Sports Dept.'}`} icon={<InboxIcon />}
      action={<button type="button" className="va-btn" style={s.ghostSmBtn} onClick={onBack}><BackIcon /> Back to queue</button>}>
      {/* Core fields */}
      <div style={{ marginBottom: 6 }}>
        <Row label="Venue" value={item.venue_name} />
        <Row label="Purpose" value={item.purpose} />
        <Row label="Participants" value={String(item.estimated_participants)} />
        <Row label="Sessions" value={`${item.sessionCount}${item.firstStart ? ` · from ${new Date(item.firstStart).toLocaleDateString()}` : ''}`} />
        <Row label="Forwarded at" value={item.forwarded_at ? new Date(item.forwarded_at).toLocaleString() : '—'} />
        <Row label="Coordinator's note" value={item.feasibility_note ?? '—'} />
      </div>

      {/* Coordinator's proposed schedule (if any) */}
      {proposedSessions && proposedSessions.length > 0 && (
        <div style={s.infoPanelBlue}>
          <div style={{ ...s.sectionLabel, color: palette.accent }}>Coordinator proposed alternative schedule</div>
          {proposedSessions.map((ps) => (
            <div key={ps.sessionNo} style={{ fontSize: 13.5, color: palette.navy900, marginBottom: 4 }}>
              Session {ps.sessionNo}: {new Date(ps.startAt).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })} · {new Date(ps.startAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}–{new Date(ps.endAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
            </div>
          ))}
        </div>
      )}

      {/* Pitch metadata summary */}
      {meta && (
        <div style={s.infoPanel}>
          <div style={s.sectionLabel}>Booking Pitch Details</div>
          <div style={{ display: 'grid', gap: 7 }}>
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
              <div key={k} className="va-detail-grid" style={{ display: 'grid', gridTemplateColumns: '150px 1fr', fontSize: 13.5, gap: 4 }}>
                <span style={{ font: '700 11px Inter, sans-serif', color: palette.slate400, textTransform: 'uppercase', letterSpacing: '0.04em', paddingTop: 2 }}>{k}</span>
                <span style={{ color: palette.navy900 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'none' && (
        <div style={s.actionRow}>
          <button className="va-btn" style={s.approveBtn} disabled={busy} onClick={approve}><TickIcon /> Approve</button>
          <button className="va-btn" style={s.dangerBtn} onClick={() => setMode('reject')}>Reject…</button>
          <button className="va-btn" style={s.ghostBtn} onClick={() => setMode('return')}>Return to Coordinator…</button>
          <button className="va-btn" style={s.ghostBtn} onClick={onBack}>Back</button>
        </div>
      )}
      {mode !== 'none' && (
        <div style={{ marginTop: 18 }}>
          <label style={s.lbl}>{mode === 'reject' ? 'Rejection reason (shown to requester)' : 'Note for the Coordinator'}</label>
          <textarea className="va-input" style={{ ...s.input, paddingLeft: 14, resize: 'vertical', minHeight: 84 }} rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'reject' ? 'e.g. The venue is reserved for the inter-university fixture that week.' : 'e.g. Please check whether the evening slot can move to Saturday.'} />
          <div style={s.actionRow}>
            <button className="va-btn" style={mode === 'reject' ? s.dangerBtn : s.approveBtn} disabled={!text.trim() || busy}
              onClick={mode === 'reject' ? reject : returnIt}>
              {mode === 'reject' ? 'Confirm rejection' : 'Return to Coordinator'}
            </button>
            <button className="va-btn" style={s.ghostBtn} onClick={() => setMode('none')}>Cancel</button>
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
  const [sportCategoryIds, setSports] = useState<number[]>(editing?.sports.map((sp) => sp.sport_category_id) ?? []);
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
    ...s.input,
    ...(hasErr ? s.inputErr : {}),
  });

  return (
    <form onSubmit={submit}>
      <div className="va-form-grid" style={s.formGrid}>
        {/* Name */}
        <Field label="Venue name" required icon={<BuildingIcon />} error={fieldErrors.name}>
          <input className="va-input" style={fieldInp(!!fieldErrors.name)} value={name}
            onChange={(e) => { setName(e.target.value); setFieldErrors((p) => ({ ...p, name: '' })); }}
            placeholder="e.g. Main Sports Hall" />
        </Field>

        {/* Location */}
        <Field label="Building / Location" required icon={<PinIcon />}>
          <input className="va-input" style={s.input} value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Sports Block, Ground Floor" />
        </Field>

        {/* Capacity */}
        <Field label="Capacity" required icon={<PeopleIcon />} error={fieldErrors.capacity}>
          <input type="number" min={1} step={1} className="va-input" style={fieldInp(!!fieldErrors.capacity)}
            value={capacity} onChange={(e) => { setCapacity(e.target.value); setFieldErrors((p) => ({ ...p, capacity: '' })); }} />
        </Field>

        {/* Setting */}
        <Field label="Setting" required icon={<GearIcon />} select>
          <select className="va-input" style={s.select} value={isIndoor ? '1' : '0'} onChange={(e) => setIndoor(e.target.value === '1')}>
            <option value="1">Indoor</option>
            <option value="0">Outdoor</option>
          </select>
        </Field>

        {/* Surface type */}
        <Field label="Surface type" required icon={<LayersIcon />} select>
          <select className="va-input" style={s.select} value={surfaceType} onChange={(e) => setSurface(e.target.value)}>
            <option value="">— Not specified —</option>
            {SURFACE_TYPES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
        </Field>

        {/* Availability status (edit only) */}
        {isEdit ? (
          <Field label="Availability status" required icon={<PulseIcon />} select>
            <select className="va-input" style={s.select} value={availabilityStatus} onChange={(e) => setAvailStatus(e.target.value as VenueAvailabilityStatus)}>
              <option value="AVAILABLE">Available</option>
              <option value="UNDER_MAINTENANCE">Under Maintenance</option>
              <option value="CLOSED">Closed</option>
            </select>
          </Field>
        ) : <div className="va-hide-mobile" aria-hidden />}

        {/* Description — full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Description" icon={<DocIcon size={16} />} top>
            <textarea className="va-input" style={{ ...s.input, resize: 'vertical', minHeight: 76, paddingTop: 11 }} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes — surface condition, markings, facilities…" maxLength={500} />
          </Field>
          <div style={{ fontSize: 11.5, color: palette.slate500, textAlign: 'right', marginTop: 4 }}>{description.length}/500</div>
        </div>

        {/* Sports — required, full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <span style={{ ...s.lbl, ...(fieldErrors.sports ? { color: '#C0392B' } : {}) }}>
            <span style={s.lblIcon}><BallIcon /></span>
            Sports <span style={s.req}>*</span> <span style={{ fontWeight: 500, color: palette.slate400 }}>(select all that apply)</span>
          </span>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8,
            ...(fieldErrors.sports ? { padding: 10, borderRadius: 12, border: '1px solid #F3CACA', background: '#FFF8F8' } : {}),
          }}>
            {cats.length === 0 && <span style={{ fontSize: 13, color: palette.slate400 }}>No sport categories found.</span>}
            {cats.map((c) => {
              const on = sportCategoryIds.includes(c.sport_category_id);
              return (
                <label key={c.sport_category_id} className="va-chip" style={{ ...s.chip, ...(on ? s.chipOn : null) }}>
                  <input type="checkbox" checked={on}
                    onChange={() => toggleSport(c.sport_category_id)} style={{ margin: 0, width: 15, height: 15 }} />
                  {c.name}
                </label>
              );
            })}
          </div>
          {fieldErrors.sports && <span style={s.fieldErr}>{fieldErrors.sports}</span>}
        </div>

        {/* Photos — full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <span style={s.lbl}>
            <span style={s.lblIcon}><ImageIcon /></span>
            Photos <span style={{ fontWeight: 500, color: palette.slate400 }}>(up to 3, max 400 KB each)</span>
          </span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-start' }}>
            {photos.map((p, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img src={p} alt={`Photo ${i + 1}`} style={{ width: 108, height: 78, objectFit: 'cover', borderRadius: 10, border: `1px solid ${palette.slate500}`, display: 'block' }} />
                <button type="button" aria-label={`Remove photo ${i + 1}`}
                  style={s.photoRemove}
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {photos.length < 3 && (
              <button type="button" className="va-dropzone" onClick={() => fileRef.current?.click()} style={s.dropzone}>
                <CameraIcon />Add photo
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handlePhotoUpload} />
          </div>
        </div>

        {/* Actions */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <button className="va-btn" style={s.primaryBtn} disabled={busy}>
            {isEdit ? <SaveIcon /> : <SendIcon />}
            {busy ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save Changes' : 'Add Venue')}
          </button>
          {onCancel && <button type="button" className="va-btn" style={s.ghostBtn} onClick={onCancel}>Cancel</button>}
        </div>
      </div>
    </form>
  );
}

// ── Venue Detail Modal ──
function VenueDetailModal({ venue, onClose }: { venue: Venue; onClose: () => void }) {
  return (
    <Modal title="Venue Details" onClose={onClose} wide>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
        <span style={s.formHeadIcon}><BuildingIcon size={20} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: palette.navy900 }}>{venue.name}</div>
          {venue.location && <div style={{ fontSize: 13, color: palette.slate400, marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}><PinIcon />{venue.location}</div>}
        </div>
        <span style={{ ...s.badge, ...AVAIL_STYLE[venue.availability_status], fontSize: 12, padding: '5px 12px' }}>
          {AVAIL_LABEL[venue.availability_status]}
        </span>
      </div>

      <div className="va-detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <DetailField label="Capacity" value={String(venue.capacity)} />
        <DetailField label="Setting" value={venue.is_indoor ? 'Indoor' : 'Outdoor'} />
        <DetailField label="Surface" value={venue.surface_type ?? '—'} />
        <DetailField label="Sports" value={venue.sports.length > 0 ? venue.sports.map((sp) => sp.sport_name).join(', ') : '—'} />
      </div>

      {venue.description && (
        <div style={{ marginBottom: 16 }}>
          <div style={s.sectionLabel}>Description</div>
          <div style={{ fontSize: 14, color: palette.navy900, lineHeight: 1.55 }}>{venue.description}</div>
        </div>
      )}

      {venue.photos.length > 0 && (
        <div>
          <div style={s.sectionLabel}>Photos</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {venue.photos.map((p, i) => (
              <img key={i} src={p} alt={`${venue.name} ${i + 1}`}
                style={{ width: 150, height: 100, objectFit: 'cover', borderRadius: 10, border: `1px solid ${palette.slate500}` }} />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${palette.slate100}`, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="va-btn" style={s.ghostBtn} onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.detailTile}>
      <div style={{ font: '700 11px Inter, sans-serif', color: palette.slate400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, color: palette.navy900, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// ── Shared components ──
function Row({ label, value }: { label: string; value: string }) {
  return <div className="va-detail-grid" style={s.detailRow}><div style={s.detailLabel}>{label}</div><div style={s.detailValue}>{value}</div></div>;
}
function Panel({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="va-card" style={s.card}>
      <div style={s.panelHead}>
        <span style={s.panelHeadLeft}>
          {icon && <span style={s.panelIcon}>{icon}</span>}
          <span>{title}</span>
        </span>
        {action}
      </div>
      <div style={s.panelBody}>{children}</div>
    </section>
  );
}
function Field({ label, required, icon, error, select, top, children }: {
  label: string; required?: boolean; icon: ReactNode; error?: string; select?: boolean; top?: boolean; children: ReactNode;
}) {
  return (
    <label className="va-field" style={{ display: 'block' }}>
      <span style={s.lbl}>{label}{required && <span style={s.req}> *</span>}</span>
      <span style={{ position: 'relative', display: 'block' }}>
        <span className="va-field-icon" style={{ ...s.fieldIcon, ...(top ? { top: 13, transform: 'none' } : null), ...(error ? { color: '#C0392B' } : null) }}>{icon}</span>
        {children}
        {select && <span style={s.selectChevron}><ChevronDownIcon /></span>}
      </span>
      {error && <span style={s.fieldErr}>{error}</span>}
    </label>
  );
}
function StatCard({ label, value, accent, icon }: { label: string; value: number; accent: string; icon: ReactNode }) {
  return (
    <div className="va-stat" style={s.statCard}>
      <span style={{ ...s.statIcon, color: accent, background: `${accent}1f` }}>{icon}</span>
      <div>
        <div style={{ ...s.statValue, color: accent }}>{value}</div>
        <div style={s.statLabel}>{label}</div>
      </div>
    </div>
  );
}
function Avatar({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : parts[0]?.[1] ?? '')).toUpperCase() || '?';
  return <span style={s.avatar}>{chars}</span>;
}
function EmptyState({ icon, text, action }: { icon: ReactNode; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={s.emptyState}>
      <span style={s.emptyIcon}>{icon}</span>
      <p style={{ color: palette.slate500, fontSize: 14, margin: 0, maxWidth: 380 }}>{text}</p>
      {action && <button type="button" className="va-btn" style={s.ghostSmBtn} onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}
function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={s.skeletonRow}>
          <span className="va-skel" style={{ width: 36, height: 36, borderRadius: '50%', display: 'inline-block' }} />
          <div style={{ flex: 1 }}>
            <span className="va-skel" style={{ ...s.skeletonLine, width: '38%' }} />
            <span className="va-skel" style={{ ...s.skeletonLine, width: '55%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={s.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="va-modal-anim va-ui" style={{ ...s.modalBox, width: wide ? 580 : 440 }} role="dialog" aria-modal="true" aria-label={title}>
        <div style={s.modalHead}>
          <span>{title}</span>
          <button type="button" className="va-btn va-icon-btn" onClick={onClose} style={s.closeIconBtn} aria-label="Close"><XIcon /></button>
        </div>
        <div style={s.modalBody}>{children}</div>
      </div>
    </div>
  );
}

/* ---------- icons ---------- */
type IP = { size?: number };
const ico = (size: number, children: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
function BackIcon() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M9.5 3 4 8l5.5 5M4.5 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ShieldIcon() { return ico(14, <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />); }
function SearchIcon() { return ico(16, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></>); }
function AlertIcon() { return ico(16, <><path d="M12 3.5 21.5 20h-19L12 3.5z" /><path d="M12 10v4.2" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></>); }
function CheckCircleIcon() { return ico(16, <><circle cx="12" cy="12" r="9.2" /><path d="m8 12.3 2.6 2.6L16.3 9" /></>); }
function TickIcon() { return ico(16, <path d="m5 12.5 4.5 4.5L19 7.5" />); }
function InboxIcon() { return ico(17, <><path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5z" /><path d="M3.5 13.5H9l1 2h4l1-2h5.5" /></>); }
function BuildingIcon({ size = 16 }: IP) { return ico(size, <><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /><path d="M3 20h18" /><path d="M9 10.5h.01M15 10.5h.01" /></>); }
function PinIcon() { return ico(15, <><path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>); }
function PeopleIcon() { return ico(16, <><circle cx="9" cy="8" r="3" /><path d="M3 20c.8-3.2 3-5 6-5s5.2 1.8 6 5" /><circle cx="17" cy="8.5" r="2.3" /><path d="M16 13.2c2.2.4 3.6 1.9 4.2 4.3" /></>); }
function GearIcon() { return ico(16, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>); }
function LayersIcon() { return ico(16, <><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></>); }
function PulseIcon() { return ico(16, <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />); }
function DocIcon({ size = 20 }: IP) { return ico(size, <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h5M10 16h5" /></>); }
function BallIcon() { return ico(14, <><circle cx="12" cy="12" r="9" /><path d="M3.5 9.5c3 1 6 .5 8.5-2M20.5 14.5c-3-1-6-.5-8.5 2M9 3.5c1 3 .5 6-2 8.5M15 20.5c-1-3-.5-6 2-8.5" /></>); }
function ImageIcon() { return ico(14, <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m20.5 16-5-5-8 8.5" /></>); }
function CameraIcon() { return ico(22, <><path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>); }
function SendIcon() { return ico(16, <><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4 18-7z" /></>); }
function SaveIcon() { return ico(16, <><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></>); }
function EditIcon() { return ico(15, <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="m13.5 6.5 4 4" /></>); }
function PlusIcon() { return ico(15, <path d="M12 5v14M5 12h14" />); }
function XIcon() { return ico(16, <path d="M6 6l12 12M18 6 6 18" />); }
function ClockIcon() { return ico(22, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>); }
function ListBoxIcon() { return ico(17, <><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="M8 9h8M8 12.5h8M8 16h5" /></>); }
function ChevronDownIcon() { return ico(15, <path d="m6 9 6 6 6-6" />); }

/* ---------- style tokens (same card system as Accounts / Conflict Detection / Usage History) ---------- */
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';
const INPUT_BG = palette.slate50;
const INPUT_BORDER = `1.5px solid ${palette.slate300}`;

const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,

  // Header — identical to AdminAccountsScreen.
  topbar: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 32px', flexWrap: 'wrap', gap: 12 } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } as const,
  logoImg: { width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}` } as const,
  wordmark: { fontSize: 16, fontWeight: 700, color: palette.white, lineHeight: 1.2 } as const,
  wordmarkSub: { fontSize: 12, color: palette.slate400, marginTop: 1 } as const,
  topbarRight: { display: 'flex', gap: 10 } as const,
  topBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', color: palette.slate100, border: `1.5px solid ${palette.slate400}`, borderRadius: 999, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none' } as const,

  main: { flex: 1, position: 'relative', zIndex: 1, padding: '20px 24px 48px', width: '100%', maxWidth: 1240, margin: '0 auto', boxSizing: 'border-box' } as const,
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24,
    padding: '28px 28px 34px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,

  hero: { position: 'relative', textAlign: 'center', maxWidth: 600, margin: '0 auto 24px' } as const,
  heroEyebrow: {
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 14,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  heroTitle: { fontSize: 32, fontWeight: 800, color: palette.white, margin: '0 0 8px', letterSpacing: '-0.5px' } as const,
  heroSubtitle: { fontSize: 14.5, lineHeight: 1.55, color: palette.slate300, margin: 0 } as const,

  banner: {
    error: { display: 'flex', alignItems: 'center', gap: 8, background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '11px 16px', fontSize: 14, marginBottom: 16 } as const,
    ok: { display: 'flex', alignItems: 'center', gap: 8, background: '#E6F4EC', color: '#1F7A45', border: '1px solid #1F7A4555', borderRadius: 12, padding: '11px 16px', fontSize: 14, marginBottom: 16 } as const,
  },

  // Light soft-gradient cards (matches Accounts panels).
  card: { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 18, boxShadow: CARD_SHADOW, marginBottom: 22, overflow: 'hidden' } as const,
  panelHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 22px', borderBottom: `1px solid ${palette.slate300}`, background: palette.white, flexWrap: 'wrap' } as const,
  panelHeadLeft: { display: 'flex', alignItems: 'center', gap: 10, font: '700 15.5px Inter, sans-serif', color: palette.navy900 } as const,
  panelIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9, background: palette.accentWash, color: palette.accent } as const,
  panelBody: { padding: 22 } as const,
  panelActions: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } as const,
  countPill: { font: '700 12px Inter, sans-serif', padding: '5px 12px', borderRadius: 999, background: palette.accentWash, color: palette.accent } as const,

  addGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.75fr) minmax(0, 1fr)', gap: 22, alignItems: 'start' } as const,
  formHead: { display: 'flex', alignItems: 'center', gap: 14, padding: '18px 24px', background: palette.white, borderBottom: `1px solid ${palette.slate300}`, marginBottom: 18 } as const,
  formHeadIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, minWidth: 44, borderRadius: '50%', background: palette.accentWash, color: palette.accent } as const,
  formHeadTitle: { fontSize: 16.5, fontWeight: 800, color: palette.navy900 } as const,
  formHeadSub: { fontSize: 12.5, color: palette.slate500, marginTop: 3 } as const,
  closeIconBtn: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, border: `1px solid ${palette.slate300}`, background: palette.white, color: palette.slate500, cursor: 'pointer', padding: 0 } as const,

  guideList: { listStyle: 'none', margin: '0 0 22px', padding: 0, display: 'grid', gap: 14 } as const,
  guideItem: { display: 'flex', alignItems: 'flex-start', gap: 12, fontSize: 14, color: palette.slate600, lineHeight: 1.45 } as const,
  guideTick: { display: 'inline-flex', color: palette.accent, marginTop: 1 } as const,
  infoBox: { display: 'flex', gap: 12, padding: '16px 18px', borderRadius: 14, background: palette.accentWash, border: `1px solid ${palette.accentSoft}` } as const,
  infoTitle: { fontSize: 14, fontWeight: 700, color: palette.accent, marginBottom: 4 } as const,
  infoText: { fontSize: 13, color: palette.slate500, lineHeight: 1.55 } as const,

  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '18px 20px' } as const,
  lbl: { display: 'flex', alignItems: 'center', gap: 6, font: '600 12.5px Inter, sans-serif', color: palette.slate600, marginBottom: 7 } as const,
  lblIcon: { display: 'inline-flex', color: palette.accent } as const,
  req: { color: '#C0392B' } as const,
  fieldIcon: { position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: palette.slate500, pointerEvents: 'none', transition: 'color .15s ease' } as const,
  input: { width: '100%', font: '14px Inter, sans-serif', padding: '10px 14px 10px 40px', background: INPUT_BG, border: INPUT_BORDER, borderRadius: 10, color: palette.navy900, boxSizing: 'border-box' } as const,
  select: { width: '100%', font: '14px Inter, sans-serif', padding: '10px 38px 10px 40px', background: INPUT_BG, border: INPUT_BORDER, borderRadius: 10, color: palette.navy900, boxSizing: 'border-box', appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' } as const,
  selectChevron: { position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', display: 'flex', color: palette.slate500, pointerEvents: 'none' } as const,
  inputErr: { borderColor: '#C0392B', background: '#FFF8F8' } as const,
  fieldErr: { display: 'block', fontSize: 12, color: '#C0392B', marginTop: 5 } as const,

  chip: { display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, padding: '7px 14px', borderRadius: 999, border: `1.5px solid ${palette.slate300}`, background: palette.white, color: palette.slate500, userSelect: 'none' } as const,
  chipOn: { background: palette.accentWash, borderColor: palette.accent, color: palette.accent } as const,
  dropzone: { width: 108, height: 78, border: `1.5px dashed ${palette.slate400}`, borderRadius: 12, background: palette.white, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, color: palette.slate500, font: '600 12px Inter, sans-serif' } as const,
  photoRemove: { position: 'absolute', top: -7, right: -7, width: 22, height: 22, borderRadius: '50%', background: '#B3352B', color: '#fff', border: '2px solid #fff', cursor: 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 } as const,

  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 8, background: palette.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 8px 16px -8px rgba(3,22,54,0.6)' } as const,
  primarySmBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: palette.accent, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const,
  approveBtn: { display: 'inline-flex', alignItems: 'center', gap: 7, background: palette.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const,
  dangerBtn: { background: '#B3352B', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' } as const,
  ghostBtn: { background: palette.white, color: palette.slate500, border: `1.5px solid ${palette.slate300}`, borderRadius: 10, padding: '11px 22px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' } as const,
  ghostSmBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, background: palette.white, color: palette.navy900, border: `1.5px solid ${palette.slate300}`, borderRadius: 9, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' } as const,
  linkBtn: { background: 'none', border: 'none', font: '700 13px Inter, sans-serif', color: palette.accent, cursor: 'pointer', padding: '4px 8px' } as const,
  actionRow: { display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' } as const,

  statRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 22 } as const,
  statCard: { display: 'flex', alignItems: 'center', gap: 12, background: palette.slate50, border: `1px solid ${palette.slate300}`, borderRadius: 14, padding: '12px 14px' } as const,
  statIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 10 } as const,
  statValue: { fontSize: 20, fontWeight: 800, lineHeight: 1.1 } as const,
  statLabel: { fontSize: 11.5, color: palette.slate500, fontWeight: 600, marginTop: 2 } as const,

  searchBox: { position: 'relative', width: 260, maxWidth: '100%' } as const,
  searchIcon: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: palette.slate500, display: 'flex', pointerEvents: 'none' } as const,
  searchInput: { width: '100%', font: '13.5px Inter, sans-serif', padding: '9px 12px 9px 36px', background: INPUT_BG, border: INPUT_BORDER, borderRadius: 10, color: palette.navy900, boxSizing: 'border-box' } as const,

  tableWrap: { overflowX: 'auto' } as const,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 560 } as const,
  theadRow: {} as const,
  th: { textAlign: 'left', font: '700 11.5px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 12px 12px' } as const,
  td: { padding: '13px 12px', borderTop: `1px solid ${palette.slate100}`, color: palette.navy900, verticalAlign: 'middle' } as const,
  tableFoot: { fontSize: 12.5, color: palette.slate500, marginTop: 14 } as const,
  nameCell: { display: 'flex', alignItems: 'center', gap: 12 } as const,
  nameText: { fontWeight: 700, color: palette.navy900, fontSize: 14.5 } as const,
  subText: { fontSize: 12.5, color: palette.slate500, marginTop: 2 } as const,
  noteText: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: palette.slate500 } as const,
  avatar: { width: 36, height: 36, minWidth: 36, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, background: `linear-gradient(135deg, ${palette.navy800}, ${palette.accent})`, boxShadow: '0 6px 14px -6px rgba(3,22,54,0.6)' } as const,
  badge: { display: 'inline-block', font: '700 11px Inter, sans-serif', padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' } as const,
  thumb: { width: 84, height: 58, objectFit: 'cover', borderRadius: 8, border: `1px solid ${palette.slate300}` } as const,
  editHead: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: palette.slate500, marginBottom: 16 } as const,

  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '34px 16px', textAlign: 'center' } as const,
  emptyIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46, borderRadius: '50%', background: palette.accentWash, color: palette.accent } as const,
  skeletonRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${palette.slate100}` } as const,
  skeletonLine: { display: 'inline-block', height: 10, borderRadius: 5 } as const,

  detailRow: { display: 'grid', gridTemplateColumns: '170px 1fr', gap: 4, padding: '11px 0', borderTop: `1px solid ${palette.slate100}` } as const,
  detailLabel: { font: '700 12.5px Inter, sans-serif', color: palette.slate500 } as const,
  detailValue: { fontSize: 14.5, color: palette.navy900 } as const,
  detailTile: { background: palette.slate50, border: `1px solid ${palette.slate300}`, borderRadius: 12, padding: '11px 14px' } as const,
  sectionLabel: { font: '700 11.5px Inter, sans-serif', color: palette.slate500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 } as const,
  infoPanel: { margin: '16px 0', padding: '14px 16px', background: palette.white, border: `1px solid ${palette.slate300}`, borderRadius: 14 } as const,
  infoPanelBlue: { margin: '16px 0', padding: '14px 16px', background: palette.accentWash, border: `1px solid ${palette.accentSoft}`, borderRadius: 14 } as const,

  overlay: { position: 'fixed', inset: 0, background: 'rgba(3,22,54,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 } as const,
  modalBox: { background: palette.white, borderRadius: 16, boxShadow: '0 24px 60px -20px rgba(3,22,54,0.6)', maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto' } as const,
  modalHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: `1px solid ${palette.slate300}`, font: '700 15.5px Inter, sans-serif', color: palette.navy900, background: palette.slate50 } as const,
  modalBody: { padding: 22 } as const,

  footer: { textAlign: 'center', padding: '20px 24px', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55`, position: 'relative', zIndex: 1 } as const,
  footerLink: { color: palette.accentSoft, textDecoration: 'none', fontWeight: 600 } as const,
} satisfies Record<string, React.CSSProperties | Record<string, React.CSSProperties>>;
