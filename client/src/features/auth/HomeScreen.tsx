/**
 * Signed-in home. Role-aware landing after login.
 *
 * Layout re-design: below the hero card, features are now grouped into
 * "Accounts Management" / "Equipment" / "Venue & Calendar" / "Activity &
 * History" sections, each laid out as alternating text-block + card-grid
 * rows (text left/cards right, then flipped, then flipped again, ...) —
 * modeled on a reference two-column marketing layout the user provided.
 * Colors are NOT taken from that reference; every color here is still
 * LandingScreen's own `palette` (navy900/800/deep, slate scale, single
 * #1C398E accent), and the feature cards reuse the exact same card design
 * already used elsewhere on this screen.
 *
 * Frontend-only change: same feature set, same per-role conditions, same
 * destination routes as before — `getFeatures()` is untouched; only how
 * those features are grouped and displayed changed. Sign-out still calls
 * the same `logout()` from useAuth(); no auth/session logic touched.
 */
import type { ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';

type Role = 'STUDENT' | 'EXTERNAL' | 'COORDINATOR' | 'SUPER_ADMIN';

const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  EXTERNAL: 'External',
  COORDINATOR: 'Coordinator',
  SUPER_ADMIN: 'Administration Staff',
};

interface Feature {
  key: string;
  label: string;
  to: string;
  description: string;
  icon: ReactNode;
}

/** Same routes, same per-role conditions, same order as before. */
function getFeatures(role: Role): Feature[] {
  const features: Feature[] = [];
  const push = (f: Feature) => features.push(f);

  push({ key: 'profile', label: 'My Profile', to: '/profile', description: 'View and update your account details.', icon: <ProfileIcon /> });

  if (role === 'SUPER_ADMIN') {
    push({ key: 'dashboard', label: 'Admin Dashboard', to: '/dashboard', description: 'Platform-wide metrics and activity at a glance.', icon: <DashboardIcon /> });
    push({ key: 'manage-accounts', label: 'Manage Accounts', to: '/admin/accounts', description: 'Approve, edit, and manage every account.', icon: <PeopleIcon /> });
  }
  if (role === 'COORDINATOR') {
    push({ key: 'view-accounts', label: 'View Accounts', to: '/admin/accounts', description: 'Browse verified accounts across the platform.', icon: <EyeIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'inventory', label: 'Inventory', to: '/inventory', description: 'Track all sports equipment stock.', icon: <BoxIcon /> });
  }

  push({ key: 'availability', label: 'Equipment Availability', to: '/availability', description: "Check what's available to borrow right now.", icon: <ToolIcon /> });

  if (role === 'COORDINATOR') {
    push({ key: 'borrow-queue', label: 'Borrow Queue', to: '/borrow-queue', description: 'Review and process pending borrow requests.', icon: <QueueIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'active-borrows', label: 'Active Borrows', to: '/active-borrows', description: 'See equipment currently checked out.', icon: <ClipboardIcon /> });
  }
  if (role === 'STUDENT' || role === 'EXTERNAL') {
    push({ key: 'book-venue', label: 'Book a Venue', to: '/book-venue', description: 'Reserve a court or venue for your activity.', icon: <PinIcon /> });
  }
  if (role === 'COORDINATOR') {
    push({ key: 'venue-queue', label: 'Venue Queue', to: '/venue-queue', description: 'Manage pending venue booking requests.', icon: <QueueIcon /> });
    push({ key: 'equipment-alerts', label: 'Equipment Alerts', to: '/equipment-alerts', description: 'Stay on top of overdue or low-stock alerts.', icon: <BellIcon /> });
  }
  if (role === 'SUPER_ADMIN') {
    push({ key: 'venue-approvals', label: 'Venue Approvals', to: '/venue-approvals', description: 'Approve or decline pending venue requests.', icon: <ShieldCheckIcon /> });
  }
  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'conflict-detection', label: 'Conflict Detection', to: '/conflict-detection', description: 'Spot and resolve scheduling conflicts.', icon: <AlertIcon /> });
  }

  push({ key: 'calendar', label: 'Calendar', to: '/calendar', description: 'See all bookings and events in one view.', icon: <CalendarIcon /> });
  push({ key: 'usage-history', label: 'Usage History', to: '/usage-history', description: 'Review past bookings and borrow records.', icon: <HistoryIcon /> });

  if (role === 'SUPER_ADMIN' || role === 'COORDINATOR') {
    push({ key: 'offline-fallback', label: 'Offline Fallback Entry', to: '/offline-fallback', description: 'Log activity manually when offline.', icon: <WifiOffIcon /> });
  }

  return features;
}

/* ---------- grouping: which section each feature belongs under ----------
   Every feature from getFeatures() (any role) maps to exactly one of these
   four categories. A role only ever sees the section if it actually has a
   feature in that bucket, so Student/External naturally get short sections
   (e.g. just "My Profile" under Accounts) while Admin/Coordinator get full
   ones — same underlying feature list, just grouped for display. */
type Category = 'account' | 'equipment' | 'venue' | 'activity';

const FEATURE_CATEGORY: Record<string, Category> = {
  profile: 'account',
  dashboard: 'account',
  'manage-accounts': 'account',
  'view-accounts': 'account',
  inventory: 'equipment',
  availability: 'equipment',
  'borrow-queue': 'equipment',
  'active-borrows': 'equipment',
  'equipment-alerts': 'equipment',
  'book-venue': 'venue',
  'venue-queue': 'venue',
  'venue-approvals': 'venue',
  'conflict-detection': 'venue',
  calendar: 'venue',
  'usage-history': 'activity',
  'offline-fallback': 'activity',
};

const SECTION_META: Record<Category, { eyebrow: string; heading: string; description: string; cta: string }> = {
  account: {
    eyebrow: 'Account & Access',
    heading: 'Account Management',
    description: 'Keep your profile information up to date, review account activity, and — where your role allows — approve, edit, verify, and manage registered users across the Sports Management Portal.',
    cta: 'Manage Accounts',
  },
  equipment: {
    eyebrow: 'Gear & Stock',
    heading: 'Equipment Management',
    description: 'Track inventory levels, see what\u2019s available to borrow right now, and keep an eye on every active loan and low-stock alert.',
    cta: 'Check Equipment',
  },
  venue: {
    eyebrow: 'Courts & Bookings',
    heading: 'Venue Management',
    description: 'Manage the complete venue workflow — from reviewing booking requests and resolving scheduling conflicts to keeping every approved court and facility reservation organized in one calendar.',
    cta: 'View Calendar',
  },
  activity: {
    eyebrow: 'Records',
    heading: 'History & Records',
    description: 'Keep a clear record of previous venue bookings and equipment activity, while maintaining operational continuity through manual offline entries whenever a connection is unavailable.',
    cta: 'View History',
  },
};

const SECTION_ORDER: Category[] = ['account', 'equipment', 'venue', 'activity'];

interface Section {
  category: Category;
  features: Feature[];
}

/** Buckets a role's features into the four sections above, keeping each
 *  bucket's internal order the same as getFeatures() produced, and only
 *  including sections that actually have something in them for this role. */
function groupIntoSections(features: Feature[]): Section[] {
  const buckets = new Map<Category, Feature[]>();
  for (const f of features) {
    const cat = FEATURE_CATEGORY[f.key] ?? 'activity';
    const bucket = buckets.get(cat);
    if (bucket) bucket.push(f);
    else buckets.set(cat, [f]);
  }
  return SECTION_ORDER
    .filter((cat) => buckets.has(cat))
    .map((cat) => ({ category: cat, features: buckets.get(cat)! }));
}

export default function HomeScreen() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="bukc-home" style={s.page}>
        <HomeStyles />
        <div style={s.glowA} aria-hidden />
        <div style={s.glowB} aria-hidden />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;

  const role = (user.role in ROLE_LABEL ? user.role : 'SUPER_ADMIN') as Role;
  const label = ROLE_LABEL[role];
  const sections = groupIntoSections(getFeatures(role));

  return (
    <div className="bukc-home" style={s.page}>
      <HomeStyles />
      <div style={s.glowA} aria-hidden />
      <div style={s.glowB} aria-hidden />

      {/* Header stays exactly where it always was: flush at the top, logo
         top-left, on the page's own (unchanged) navy background. */}
      <header className="bukc-container" style={s.topbar}>
        <div style={s.brand}>
          <img src="/landing/bu_logo.png" alt="Bahria University" style={s.logoImg} />
          <div>
            <div style={s.wordmark}>Bahria University</div>
            <div style={s.wordmarkSub}>Sports Management Portal</div>
          </div>
        </div>
        <button
          type="button"
          className="bukc-signout"
          style={s.signOutBtn}
          onClick={() => { void logout(); navigate('/'); }}
        >
          <SignOutIcon /> Sign out
        </button>
      </header>

      {/* Hero card: inset from the left/right edges (same amount as the
         sections below, via .bukc-container), showing the banner photo at
         its own original colors — no darkening gradient over it. The
         welcome text sits on the left inside the card with its own padding. */}
      <div className="bukc-container" style={s.heroOuter}>
        <div className="bukc-hero-card" style={s.heroCard}>
          <span className="bukc-glass-chip" style={s.heroEyebrow}>
            <span style={s.heroEyebrowDot} aria-hidden />
            {label} Portal
          </span>
          <h1 style={s.heroTitle}>Welcome back, {firstName(user.fullName)}!</h1>
          <span style={s.heroUnderline} aria-hidden />
          <p style={s.heroMeta}>{user.email} · {label}</p>
          <p style={s.heroSubtitle}>Manage your sports activities, bookings, and equipment — all in one place.</p>
        </div>
      </div>

      <main style={s.main}>
        {sections.map((sec, i) => {
          const meta = SECTION_META[sec.category];
          // Reference layout: every section keeps the text on the left
          // and the feature-card grid on the right.
          const firstRoute = sec.features[0]?.to ?? '/profile';
          return (
            <section key={sec.category} className="bukc-container bukc-section">
              <div className="bukc-section-inner">
                <div className="bukc-section-text" style={s.sectionText}>
                  <span style={s.sectionEyebrow}>{meta.eyebrow}</span>
                  <h2 style={s.sectionHeading}>{meta.heading}</h2>
                  <span className="bukc-heading-line" style={s.headingLine} aria-hidden />
                  <p style={s.sectionDesc}>{meta.description}</p>
                </div>

                <div className="bukc-section-cards" style={s.sectionCards}>
                  {sec.features.map((f, j) => (
                    <div key={f.key} className="bukc-tile" style={{ ...s.tile, animationDelay: `${j * 45}ms` }}>
                      <div className="bukc-tile-icon" style={s.tileIcon}>{f.icon}</div>
                      <h3 style={s.tileLabel}>{f.label}</h3>
                      <p style={s.tileDesc}>{f.description}</p>
                      <Link to={f.to} className="bukc-view-btn" style={s.viewBtn}>
                        View <ArrowIcon />
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </main>

      <footer className="bukc-footer bukc-container" style={s.footer}>
        <div style={s.footerCol}>
          <ShieldCheckIcon />
          <span>
            Need help?<br />
            <span style={s.footerLink}>Contact Sports Office <ArrowIcon /></span>
          </span>
        </div>
        <div style={s.footerCenter}>
          2026 © <strong style={{ color: palette.slate100 }}>Bahria University</strong> — Sports Management Portal
        </div>
        <div style={{ ...s.footerCol, ...s.footerColRight }}>
          <span style={{ textAlign: 'right' }}>Go Beyond Limits.<br />Play. Train. Excel.</span>
          <ChevronMarkIcon />
        </div>
      </footer>
    </div>
  );
}

function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

function HomeStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      * { box-sizing: border-box; }
      .bukc-home { font-family: 'Inter', system-ui, sans-serif; }

      /* Single shared width/inset used by the hero text, every section, and
         the footer, so their left/right edges always line up exactly. */
      .bukc-container { width: 100%; max-width: 1320px; margin: 0 auto; padding-left: 22px; padding-right: 22px; }

      /* Main feature area — compact, editorial two-column composition. */
      .bukc-section {
        padding: 48px 22px;
        margin-bottom: 0;
        position: relative;
      }
      .bukc-section + .bukc-section {
        padding-top: 34px;
      }
      .bukc-section-inner {
        display: grid;
        grid-template-columns: minmax(300px, 0.82fr) minmax(500px, 1fr);
        align-items: center;
        gap: 64px;
        max-width: 1180px;
        margin: 0 auto;
      }
      .bukc-section-text {
        max-width: 455px;
        padding: 4px 0;
        animation: bukcSectionIn .65s cubic-bezier(.2,.75,.25,1) both;
      }
      .bukc-section-cards {
        width: 100%;
        max-width: 560px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        align-items: stretch;
      }
      .bukc-section:nth-child(2n) .bukc-section-inner {
        grid-template-columns: minmax(500px, 1fr) minmax(300px, 0.82fr);
      }
      .bukc-section:nth-child(2n) .bukc-section-text {
        order: 2;
        justify-self: end;
      }
      .bukc-section:nth-child(2n) .bukc-section-cards {
        order: 1;
      }

      .bukc-tile {
        position: relative;
        min-height: 164px;
        opacity: 0;
        animation: bukcTileIn .58s cubic-bezier(.2,.75,.25,1) forwards;
        background: linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%);
        border: 1px solid rgba(202, 213, 226, .9);
        border-radius: 16px;
        box-shadow: 0 12px 30px -22px rgba(3, 22, 54, .85);
        transition: transform .24s cubic-bezier(.2,.75,.25,1),
                    box-shadow .24s ease,
                    border-color .24s ease,
                    background .24s ease;
        overflow: hidden;
      }
      .bukc-tile-icon {
        background: #E7EEFF;
        border: 1px solid #C5D2ED;
        color: #1C398E;
        transition: background-color .22s ease, border-color .22s ease, transform .22s ease;
      }
      .bukc-tile:hover .bukc-tile-icon {
        background-color: #E0E9FF;
        color: #3157B7;
      }
      .bukc-view-btn { transition: none; }
      @keyframes bukcTileIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .bukc-cta-btn { transition: filter .15s ease, gap .18s ease; }
      .bukc-cta-btn:hover { filter: brightness(1.1); }

      .bukc-heading-line {
        display: block;
        width: 72px;
        height: 3px;
        border-radius: 999px;
        background: linear-gradient(90deg, #F8D56A 0%, #FFE9A8 100%);
        box-shadow: 0 0 10px rgba(248, 213, 106, .20);
      }
      @keyframes bukcSectionIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes bukcTileIn {
        from { opacity: 0; transform: translateY(18px) scale(.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* Glassmorphism for the "Student Portal" chip — frosted, translucent,
         blurring whatever part of the banner sits behind it. */
      .bukc-glass-chip {
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        box-shadow: 0 4px 18px rgba(3, 22, 54, 0.35), inset 0 1px 0 rgba(255,255,255,0.15);
      }

      .bukc-signout {
        background: transparent;
        border: 1.5px solid #90A1B9;
        color: #E2E8F0;
        transition: background-color .18s ease, border-color .18s ease, color .18s ease;
      }
      .bukc-signout:hover {
        background-color: #1C398E;
        border-color: #1C398E;
        color: #FFFFFF;
      }

      @media (max-width: 980px) {
        .bukc-section { padding: 34px 22px; }
        .bukc-section-inner { gap: 42px; }
        .bukc-section-text { flex: 1 1 360px; max-width: 400px; }
        .bukc-section-cards { flex: 1 1 400px; width: 100%; max-width: 440px; }
      }

      @media (max-width: 760px) {
        .bukc-section { padding: 28px 22px; }
        .bukc-section-inner { flex-direction: column; align-items: flex-start; gap: 26px; }
        .bukc-section-text, .bukc-section-cards { width: 100%; max-width: 100%; }
        .bukc-section-cards { flex-basis: auto; }
      }

      @media (max-width: 620px) {
        .bukc-container { padding-left: 16px; padding-right: 16px; }
        .bukc-section-cards { grid-template-columns: repeat(2, 1fr); }
        .bukc-footer { flex-direction: column; gap: 14px; text-align: center; }
        .bukc-footer > div { justify-content: center !important; }
      }
      @media (prefers-reduced-motion: reduce) {
        .bukc-tile { animation: none !important; opacity: 1 !important; }
      }
    `}</style>
  );
}

/* ---------- icons (22px, stroke="currentColor" — color set by whatever
   wraps them, e.g. .bukc-tile-icon on the feature cards) ---------- */
function ProfileIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.6"/><path d="M5 20c1-3.5 4-5.5 7-5.5s6 2 7 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function DashboardIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.6"/><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.4" stroke="currentColor" strokeWidth="1.6"/><rect x="13.5" y="10.5" width="7" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.6"/><rect x="3.5" y="13" width="7" height="7.5" rx="1.4" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function PeopleIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6"/><path d="M3 20c.8-3.2 3-5 6-5s5.2 1.8 6 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="17" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.5"/><path d="M15.5 12.2c2.4.3 4 1.8 4.5 4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>; }
function EyeIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function BoxIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M3.7 7.6 12 11.5l8.3-3.9M12 11.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/></svg>; }
function ToolIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a3.6 3.6 0 0 1-4.9 4.4L4.5 16l1.9 1.9 5.4-5.3a3.6 3.6 0 0 1 4.4-4.9l-1.9 1.9-1.6-1.6 1.9-1.9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>; }
function QueueIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6.5h16M4 12h16M4 17.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function ClipboardIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="5" y="4.5" width="14" height="16" rx="1.6" stroke="currentColor" strokeWidth="1.6"/><rect x="8.5" y="3" width="7" height="3" rx="1" stroke="currentColor" strokeWidth="1.6"/><path d="M8.5 11.5h7M8.5 15.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function PinIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.4 7-11.5a7 7 0 1 0-14 0C5 14.6 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><circle cx="12" cy="9.3" r="2.4" stroke="currentColor" strokeWidth="1.6"/></svg>; }
function BellIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 16V10a6 6 0 0 1 12 0v6l1.6 2.3H4.4L6 16z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9.5 20.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function ShieldCheckIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3.5l7 2.8v6c0 4.6-3 7.8-7 9.2-4-1.4-7-4.6-7-9.2v-6l7-2.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M9 12l2 2 4-4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function AlertIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3.5 21.5 20h-19L12 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M12 10v4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="17" r="0.9" fill="currentColor"/></svg>; }
function CalendarIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="14.5" rx="1.8" stroke="currentColor" strokeWidth="1.6"/><path d="M4 9.5h16M8 3.5v4M16 3.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function HistoryIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="13" r="7.5" stroke="currentColor" strokeWidth="1.6"/><path d="M12 9v4.2l3 1.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M8.5 3.5A9.6 9.6 0 0 0 4.3 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function WifiOffIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 8.5c2.6-2.2 6-3.3 9-3.3M21 8.5c-1.3-1.1-2.8-1.9-4.4-2.5M6.5 12.3c1.6-1.2 3.5-1.8 5.5-1.8M17.5 12.3a9 9 0 0 0-2-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M9.8 16a4.8 4.8 0 0 1 4.4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="19" r="1" fill="currentColor"/><path d="M2.5 3 21.5 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
function ArrowIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SignOutIcon() { return <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6.5 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10.5 5 14 8l-3.5 3M14 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ChevronMarkIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6 15.5 12 10l6 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M6 10.5 12 5l6 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.55"/></svg>; }

/* ---------- palette — identical values to LandingScreen's `palette` ---------- */
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

const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  glowA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  glowB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,

  /* Small breathing room above the card (below the header) and below it
     (before the first section starts). */
  heroOuter: { marginTop: 8, marginBottom: 30 } as const,

  /* Hero card: inset on both sides (same edges as every section, via
     .bukc-container), rounded, showing the banner at its own true colors —
     no darkening gradient laid over it, per request. */
  heroCard: {
    position: 'relative', borderRadius: 20, overflow: 'hidden',
    backgroundImage: `url('/home/hero-banner.png')`,
    backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
    padding: '40px 40px 36px', minHeight: 540,
    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
  } as const,

  topbar: {
    position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '18px 0',
  } as const,
  brand: { display: 'flex', alignItems: 'center', gap: 12 } as const,
  logoImg: {
    width: 40, height: 40, borderRadius: 10, objectFit: 'contain',
    background: palette.slate50, padding: 4, border: `1px solid ${palette.slate300}`,
  } as const,
  wordmark: { fontSize: 16, fontWeight: 700, color: palette.white, lineHeight: 1.2 } as const,
  wordmarkSub: { fontSize: 12, color: palette.slate400, marginTop: 1 } as const,
  signOutBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 7,
    borderRadius: 999, padding: '8px 16px', fontSize: 13.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  } as const,

  main: { position: 'relative', zIndex: 1, flex: 1, padding: '0 0 40px', display: 'flex', flexDirection: 'column' } as const,

  /* Text shadow stands in for the old darkening gradient, since the banner
     itself is no longer tinted — keeps the left-aligned copy readable
     against a bright, untouched photo. */
  heroEyebrow: {
    display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', width: 'fit-content',
    fontSize: 12.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 16, color: palette.white,
    background: `${palette.navy900}55`, border: `1px solid rgba(255,255,255,0.35)`,
  } as const,
  heroEyebrowDot: {
    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
    background: palette.white, boxShadow: `0 0 6px ${palette.accent}, 0 0 0 3px ${palette.accent}33`,
  } as const,
  heroTitle: {
    fontSize: 32, lineHeight: 1.2, fontWeight: 800, color: palette.white, margin: '0 0 10px', maxWidth: 560,
    textShadow: `0 2px 4px ${palette.navyDeep}, 0 4px 18px ${palette.navyDeep}cc`,
  } as const,
  heroUnderline: { display: 'block', width: 42, height: 4, borderRadius: 999, background: palette.accent, marginBottom: 14 } as const,
  heroMeta: {
    fontSize: 14, color: palette.slate100, margin: '0 0 6px',
    textShadow: `0 1px 3px ${palette.navyDeep}, 0 3px 12px ${palette.navyDeep}cc`,
  } as const,
  heroSubtitle: {
    fontSize: 13, color: palette.slate100, margin: 0, maxWidth: 440, lineHeight: 1.6,
    textShadow: `0 1px 3px ${palette.navyDeep}, 0 3px 12px ${palette.navyDeep}cc`,
  } as const,

  /* --- Section (text block + card grid), one per category --- */
  sectionEyebrow: {
    display: 'block', fontSize: 11.5, fontWeight: 800, letterSpacing: 0.85, textTransform: 'uppercase',
    color: '#DDE7FF', marginBottom: 9,
  } as const,
  sectionHeading: {
    fontSize: 36, lineHeight: 1.12, fontWeight: 800, color: palette.white,
    margin: '0 0 13px', letterSpacing: '-0.7px',
  } as const,
  headingLine: {
    width: '100%', maxWidth: 455, height: 4, borderRadius: 999, display: 'block',
    background: 'linear-gradient(90deg, #F2B233 0%, #FFD66B 100%)',
    margin: '0 0 18px',
  } as const,
  sectionDesc: {
    fontSize: 14, lineHeight: 1.85, letterSpacing: '0.05px',
    color: palette.slate400, margin: 0, maxWidth: 445,
  } as const,
  sectionText: {} as const,
  sectionCards: {} as const,
  ctaBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    background: palette.accent, color: palette.white, fontSize: 13.5, fontWeight: 700,
    padding: '12px 22px', borderRadius: 10, textDecoration: 'none',
  } as const,

  tile: {
    position: 'relative', borderRadius: 16,
    padding: '18px 18px 16px', display: 'flex', flexDirection: 'column', gap: 3,
  } as const,
  tileIcon: {
    width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  } as const,
  tileLabel: { fontSize: 15, fontWeight: 750, color: palette.navy900, margin: '0 0 4px' } as const,
  tileDesc: { fontSize: 12.5, lineHeight: 1.58, color: palette.slate500, margin: '0 0 12px', flex: 1 } as const,
  viewBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    background: palette.accent, color: palette.white, fontSize: 12.5, fontWeight: 700, padding: '7px 14px',
    borderRadius: 999, textDecoration: 'none',
  } as const,

  footer: {
    position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 18, padding: '20px 0', fontSize: 12.5, color: palette.slate400, borderTop: `1px solid ${palette.slate600}55`,
  } as const,
  footerCol: { display: 'flex', alignItems: 'center', gap: 10, lineHeight: 1.5 } as const,
  footerColRight: { flexDirection: 'row-reverse' } as const,
  footerCenter: { textAlign: 'center', flex: 1 } as const,
  footerLink: { color: palette.accentSoft, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 } as const,
};
