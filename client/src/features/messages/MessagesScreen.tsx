/**
 * Messages — chat with the Coordinator desk (replaces "email the head").
 *
 *   Student / External / Administration Staff → ONE screen: their chat with
 *     the Coordinators. (Students and externals can't reach the Super Admin.)
 *   Coordinator → TWO screens:
 *     1. Inbox — everyone who has written: name + enrollment no. (BUKC student),
 *        name + university (external), or Administration Staff; unread first
 *        in the badge, newest on top.
 *     2. Chat — clicking a row opens the chat with that person only (list stays
 *        on the left on wide screens, like the design reference). Go back
 *        returns to the inbox.
 *
 * Messages refresh every few seconds while the page is open; the sidebar
 * badge updates as soon as something is read or sent.
 *
 * Styling: the navy pages' look — dark navy page, frosted glass shell, light
 * cards, one accent blue (sent bubbles), soft light bubbles for received.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { ApiRequestError } from '../../lib/api.js';
import { useBackStep } from '../../components/backStack.js';
import {
  getMyChat, sendMyMessage, markMyChatRead, getInbox, getConversation, replyTo, markConversationRead,
  listAdminContacts, openAdminChat, notifyMessagesChanged,
  type ChatMessage, type ChatParty, type InboxRow, type AdminContact,
} from './api.js';

/* ---------- theme (same values as the other navy pages) ---------- */
const palette = {
  navy900: '#0F172B',
  navy800: '#132357',
  slate600: '#132357',
  slate500: '#62748E',
  slate400: '#90A1B9',
  slate300: '#CAD5E2',
  slate100: '#E2E8F0',
  slate50: '#F8FAFC',
  white: '#FFFFFF',
  accent: '#1C398E',
  accentMid: '#2F55C4',
  accentSoft: '#DBEAFE',
  accentWash: '#1C398E14',
  red: '#E5484D',
  green: '#1F9D57',
};
const CARD_BG = 'linear-gradient(145deg, #F8FAFF 0%, #EAF0FC 100%)';
const CARD_SHADOW = '0 12px 30px -22px rgba(3,22,54,.85)';
const POLL_CHAT_MS = 4000;
const POLL_INBOX_MS = 6000;
const MAX_LEN = 2000;

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong. Please try again.'; }
const visible = () => document.visibilityState === 'visible';

/* ---------- date helpers ---------- */
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function timeOf(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function dayLabel(iso: string) {
  const d = new Date(iso); const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function listTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return timeOf(iso);
  if (sameDay(d, y)) return 'Yesterday';
  if (now.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1]![0] : '')).toUpperCase() || '?';
}

/* ---------- who is this person (coordinator view) ---------- */
const ROLE_META: Record<ChatParty['party_role'], { label: string; color: string; bg: string }> = {
  STUDENT: { label: 'BUKC Student', color: '#1C398E', bg: '#DBEAFE' },
  EXTERNAL: { label: 'External', color: '#8A4B0F', bg: '#FDEBD3' },
  SUPER_ADMIN: { label: 'Administration Staff', color: '#5B2A86', bg: '#EDE3F8' },
};
function partyDetail(p: ChatParty) {
  if (p.party_role === 'STUDENT') return [p.enrollment_no, p.department].filter(Boolean).join(' · ') || 'BUKC student';
  if (p.party_role === 'EXTERNAL') return [p.institution_name, p.designation].filter(Boolean).join(' · ') || 'External';
  return 'Administration Staff';
}

/* ═══════════════════════════════ page ═══════════════════════════════ */

export default function MessagesScreen() {
  const { user, loading } = useAuth();
  if (loading) return <div className="msg-ui" style={{ minHeight: '100%', background: palette.navy900 }} />;
  if (!user) return <Navigate to="/" replace />;
  return user.role === 'COORDINATOR'
    ? <CoordinatorMessages meId={user.userId} />
    : <PartyMessages meId={user.userId} role={user.role} />;
}

function Shell({ title, subtitle, eyebrow, children }: { title: string; subtitle: string; eyebrow: string; children: ReactNode }) {
  return (
    <div className="msg-ui" style={s.page}>
      <MsgStyles />
      <div style={s.blobA} aria-hidden />
      <div style={s.blobB} aria-hidden />
      <main style={s.main}>
        <div className="msg-glass" style={s.glassPanel}>
          <div style={s.headRow}>
            <span style={s.eyebrow}>{eyebrow}</span>
            <h1 style={s.title}>{title}</h1>
            <p style={s.subtitle}>{subtitle}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/* ═══════════════════════ student / external / admin ═══════════════════════ */

function PartyMessages({ meId, role }: { meId: string; role: string }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [deskReadAt, setDeskReadAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastDeskMsg = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getMyChat();
      setMessages(r.messages);
      setDeskReadAt(r.deskLastReadAt);
      const latestDesk = [...r.messages].reverse().find((m) => m.sender_id !== meId)?.message_id ?? null;
      if (latestDesk && latestDesk !== lastDeskMsg.current && visible()) {
        lastDeskMsg.current = latestDesk;
        await markMyChatRead();
        notifyMessagesChanged();
      }
    } catch (e) { setError(errMsg(e)); }
  }, [meId]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (visible()) void load(); }, POLL_CHAT_MS);
    return () => window.clearInterval(t);
  }, [load]);

  async function send(text: string) {
    await sendMyMessage(text);
    setError(null);
    await load();
    notifyMessagesChanged();
  }

  const isAdmin = role === 'SUPER_ADMIN';
  return (
    <Shell
      eyebrow={isAdmin ? 'Administration Staff Portal' : role === 'EXTERNAL' ? 'External Portal' : 'Student Portal'}
      title="Messages"
      subtitle={isAdmin
        ? 'Talk to the Sports Coordinators. Any coordinator on duty can reply.'
        : 'Message the Sports Coordinators directly — no more emailing and waiting. Any coordinator on duty can reply.'}
    >
      {error && <div role="alert" style={box.err}><AlertIcon /> <span>{error}</span></div>}
      <div className="msg-chat-only" style={s.chatOnlyWrap}>
        <ChatPanel
          header={<ChatHeader avatar={<span style={{ ...avatar(48), background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentMid})`, color: '#fff' }}><PeopleIcon /></span>}
            name="Coordinator Desk" chip={{ label: 'Coordinators', color: palette.accent, bg: palette.accentSoft }}
            detail="BUKC Sports Department · replies come from any coordinator" />}
          messages={messages}
          isMine={(m) => m.sender_id === meId}
          showSender={(m) => m.sender_id !== meId}
          otherReadAt={deskReadAt}
          onSend={send}
          emptyTitle="Start a conversation"
          emptyText={isAdmin ? 'Send a message to the Sports Coordinators.' : 'Ask about venues, equipment, visits or anything else. The coordinators will reply here.'}
          placeholder="Type a message to the coordinators…"
        />
      </div>
    </Shell>
  );
}

/* ═══════════════════════════════ coordinator ═══════════════════════════════ */

type Filter = 'ALL' | 'UNREAD' | 'STUDENT' | 'EXTERNAL' | 'SUPER_ADMIN';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' }, { key: 'UNREAD', label: 'Unread' },
  { key: 'STUDENT', label: 'Students' }, { key: 'EXTERNAL', label: 'Externals' }, { key: 'SUPER_ADMIN', label: 'Administration' },
];

function CoordinatorMessages({ meId }: { meId: string }) {
  const [inbox, setInbox] = useState<InboxRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [admins, setAdmins] = useState<AdminContact[] | null>(null);
  const [pickAdmin, setPickAdmin] = useState(false);

  const loadInbox = useCallback(async () => {
    try { setInbox((await getInbox()).conversations); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => {
    void loadInbox();
    const t = window.setInterval(() => { if (visible()) void loadInbox(); }, POLL_INBOX_MS);
    return () => window.clearInterval(t);
  }, [loadInbox]);

  // Screen 2 → Go back (top right) returns to the inbox.
  useBackStep(selectedId !== null, () => setSelectedId(null));

  const counts = useMemo(() => {
    const c = { ALL: 0, UNREAD: 0, STUDENT: 0, EXTERNAL: 0, SUPER_ADMIN: 0 } as Record<Filter, number>;
    for (const r of inbox ?? []) { c.ALL++; c[r.party_role]++; if (r.unread > 0) c.UNREAD++; }
    return c;
  }, [inbox]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (inbox ?? []).filter((r) => {
      if (filter === 'UNREAD' && r.unread === 0) return false;
      if (filter !== 'ALL' && filter !== 'UNREAD' && r.party_role !== filter) return false;
      if (!term) return true;
      return [r.party_name, r.enrollment_no, r.institution_name, r.department, r.party_email, r.last_body]
        .some((v) => v?.toLowerCase().includes(term));
    });
  }, [inbox, search, filter]);

  async function messageAdmin() {
    setError(null);
    try {
      const list = admins ?? (await listAdminContacts()).admins;
      setAdmins(list);
      if (list.length === 0) { setError('There is no active Administration Staff account to message.'); return; }
      if (list.length === 1) { await openWith(list[0]!.user_id); return; }
      setPickAdmin((v) => !v);
    } catch (e) { setError(errMsg(e)); }
  }
  async function openWith(adminId: string) {
    try {
      const { conversationId } = await openAdminChat(adminId);
      setPickAdmin(false);
      await loadInbox();
      setSelectedId(conversationId);
    } catch (e) { setError(errMsg(e)); }
  }

  const selected = inbox?.find((r) => r.conversation_id === selectedId) ?? null;

  return (
    <Shell eyebrow="Coordinator Portal" title="Messages"
      subtitle={selectedId
        ? 'Replies go only to this person. Every coordinator sees the same conversations.'
        : 'Everyone who has messaged the desk. Open a conversation to read and reply.'}>
      {error && <div role="alert" style={box.err}><AlertIcon /> <span>{error}</span></div>}

      {selectedId === null ? (
        /* ── Screen 1: inbox ── */
        <section style={s.card}>
          <div style={s.inboxBar}>
            <div style={s.searchBox}>
              <span style={s.searchIcon}><SearchIcon /></span>
              <input type="search" className="msg-input" style={s.searchInput} value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, enrollment no., university…" aria-label="Search conversations" />
            </div>
            <div style={{ position: 'relative' }}>
              <button type="button" className="msg-btn" style={s.primaryBtn} onClick={() => void messageAdmin()}>
                <ShieldIcon /> Message Administration
              </button>
              {pickAdmin && admins && admins.length > 1 && (
                <div style={s.menu} role="menu">
                  {admins.map((a) => (
                    <button key={a.user_id} type="button" role="menuitem" className="msg-menu-item" style={s.menuItem} onClick={() => void openWith(a.user_id)}>
                      <span style={{ ...avatar(30), ...roleAvatar('SUPER_ADMIN') }}>{initials(a.full_name)}</span>
                      <span style={{ minWidth: 0 }}><b style={{ display: 'block', color: palette.navy900 }}>{a.full_name}</b><span style={{ fontSize: 12, color: palette.slate500 }}>{a.email}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={s.filterRow} role="tablist" aria-label="Filter conversations">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className="msg-chip"
                style={filter === f.key ? s.chipOn : s.chipOff} onClick={() => setFilter(f.key)}>
                {f.label}{counts[f.key] > 0 && <span style={filter === f.key ? s.chipCountOn : s.chipCount}>{counts[f.key]}</span>}
              </button>
            ))}
          </div>

          {inbox === null ? <SkeletonRows /> : shown.length === 0 ? (
            <div style={s.empty}>
              <span style={s.emptyIcon}><InboxIcon /></span>
              <b style={{ color: palette.navy900, fontSize: 16 }}>{inbox.length === 0 ? 'No messages yet' : 'Nothing matches'}</b>
              <span style={{ color: palette.slate500, fontSize: 14 }}>
                {inbox.length === 0 ? 'When a student, external or the Administration Staff writes to the desk, it will appear here.' : 'Try a different search or filter.'}
              </span>
            </div>
          ) : (
            <ul style={s.inboxList}>
              {shown.map((r) => <InboxItem key={r.conversation_id} row={r} meId={meId} onOpen={() => setSelectedId(r.conversation_id)} />)}
            </ul>
          )}
        </section>
      ) : (
        /* ── Screen 2: chat (list on the left on wide screens) ── */
        <div className="msg-split" style={s.split}>
          <aside className="msg-side" style={{ ...s.card, ...s.side }}>
            <div style={s.sideHead}>
              <b style={{ color: palette.navy900 }}>Conversations</b>
              {counts.UNREAD > 0 && <span style={s.unreadPill}>{counts.UNREAD} unread</span>}
            </div>
            <div style={{ padding: '0 12px 10px' }}>
              <div style={s.searchBox}>
                <span style={s.searchIcon}><SearchIcon /></span>
                <input type="search" className="msg-input" style={{ ...s.searchInput, padding: '9px 12px 9px 36px' }} value={search}
                  onChange={(e) => setSearch(e.target.value)} placeholder="Search conversation…" aria-label="Search conversations" />
              </div>
            </div>
            <ul style={{ ...s.inboxList, overflowY: 'auto', flex: 1 }}>
              {shown.map((r) => (
                <InboxItem key={r.conversation_id} row={r} meId={meId} compact active={r.conversation_id === selectedId}
                  onOpen={() => setSelectedId(r.conversation_id)} />
              ))}
            </ul>
          </aside>
          <CoordinatorChat key={selectedId} conversationId={selectedId} fallbackParty={selected} meId={meId}
            onChanged={() => { void loadInbox(); notifyMessagesChanged(); }} />
        </div>
      )}
    </Shell>
  );
}

function InboxItem({ row: r, meId, compact, active, onOpen }: { row: InboxRow; meId: string; compact?: boolean; active?: boolean; onOpen: () => void }) {
  const meta = ROLE_META[r.party_role];
  const unread = r.unread > 0;
  const preview = r.last_body
    ? `${r.last_from_party === false ? (r.last_sender_id === meId ? 'You: ' : 'Desk: ') : ''}${r.last_body.replace(/\s+/g, ' ')}`
    : 'No messages yet';
  return (
    <li>
      <button type="button" className={`msg-row${active ? ' is-active' : ''}${unread ? ' is-unread' : ''}`} onClick={onOpen}
        style={{ ...s.row, ...(compact ? s.rowCompact : null) }} aria-current={active ? 'true' : undefined}
        aria-label={`${r.party_name}, ${meta.label}, ${partyDetail(r)}${unread ? `, ${r.unread} unread` : ''}`}>
        <span style={{ position: 'relative', flex: '0 0 auto' }}>
          <span style={{ ...avatar(compact ? 40 : 46), ...roleAvatar(r.party_role) }}>{initials(r.party_name)}</span>
          {unread && <span style={s.avatarDot} aria-hidden />}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={s.rowTop}>
            <span style={{ ...s.rowName, fontWeight: unread ? 800 : 700 }}>{r.party_name}</span>
            <span style={{ ...s.rowTime, color: unread ? palette.accent : palette.slate500, fontWeight: unread ? 700 : 500 }}>{listTime(r.last_message_at)}</span>
          </span>
          <span style={s.rowMeta}>
            {!compact && <span style={{ ...s.roleChip, color: meta.color, background: meta.bg }}>{meta.label}</span>}
            <span style={s.rowDetail}>{partyDetail(r)}</span>
          </span>
          <span style={s.rowBottom}>
            <span style={{ ...s.rowPreview, color: unread ? palette.navy900 : palette.slate500, fontWeight: unread ? 600 : 400 }}>{preview}</span>
            {unread && <span style={s.countBadge}>{r.unread > 99 ? '99+' : r.unread}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

function CoordinatorChat({ conversationId, fallbackParty, meId, onChanged }: {
  conversationId: string; fallbackParty: InboxRow | null; meId: string; onChanged: () => void;
}) {
  const [party, setParty] = useState<ChatParty | null>(fallbackParty);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [partyReadAt, setPartyReadAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastPartyMsg = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await getConversation(conversationId);
      setParty(r.party); setMessages(r.messages); setPartyReadAt(r.partyLastReadAt);
      const latest = [...r.messages].reverse().find((m) => m.sender_id === r.party.party_id)?.message_id ?? null;
      if (visible() && latest !== lastPartyMsg.current) {
        lastPartyMsg.current = latest;
        await markConversationRead(conversationId);
        onChanged();
      }
    } catch (e) { setError(errMsg(e)); }
  }, [conversationId, onChanged]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (visible()) void load(); }, POLL_CHAT_MS);
    return () => window.clearInterval(t);
  }, [load]);

  async function send(text: string) {
    await replyTo(conversationId, text);
    setError(null);
    await load();
    onChanged();
  }

  const meta = party ? ROLE_META[party.party_role] : null;
  return (
    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {error && <div role="alert" style={box.err}><AlertIcon /> <span>{error}</span></div>}
      <ChatPanel
        header={party && meta ? (
          <ChatHeader avatar={<span style={{ ...avatar(48), ...roleAvatar(party.party_role) }}>{initials(party.party_name)}</span>}
            name={party.party_name} chip={meta} detail={partyDetail(party)} sub={party.party_email} />
        ) : <ChatHeader avatar={<span style={avatar(48)} />} name="Loading…" detail="" />}
        messages={messages}
        isMine={(m) => m.sender_role === 'COORDINATOR'}
        showSender={(m) => m.sender_role === 'COORDINATOR' ? m.sender_id !== meId : false}
        senderLabel={(m) => (m.sender_role === 'COORDINATOR' && m.sender_id !== meId ? `${m.sender_name} (coordinator)` : m.sender_name)}
        otherReadAt={partyReadAt}
        onSend={send}
        emptyTitle="No messages yet"
        emptyText={party?.party_role === 'SUPER_ADMIN' ? 'Write the first message to the Administration Staff.' : 'Nothing in this conversation yet.'}
        placeholder={party ? `Reply to ${party.party_name.split(' ')[0]}…` : 'Type a message…'}
      />
    </div>
  );
}

/* ═══════════════════════════════ chat panel ═══════════════════════════════ */

function ChatHeader({ avatar: av, name, chip, detail, sub }: {
  avatar: ReactNode; name: string; chip?: { label: string; color: string; bg: string }; detail: string; sub?: string;
}) {
  return (
    <div style={s.chatHead}>
      {av}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={s.chatName}>{name}</span>
          {chip && <span style={{ ...s.roleChip, color: chip.color, background: chip.bg }}>{chip.label}</span>}
        </div>
        {detail && <div style={s.chatDetail}>{detail}</div>}
        {sub && <div style={{ fontSize: 12.5, color: palette.slate400 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ChatPanel({ header, messages, isMine, showSender, senderLabel, otherReadAt, onSend, emptyTitle, emptyText, placeholder }: {
  header: ReactNode;
  messages: ChatMessage[] | null;
  isMine: (m: ChatMessage) => boolean;
  showSender: (m: ChatMessage) => boolean;
  senderLabel?: (m: ChatMessage) => string;
  otherReadAt: string | null;
  onSend: (text: string) => Promise<void>;
  emptyTitle: string; emptyText: string; placeholder: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastCount = useRef(0);

  const onScroll = () => {
    const el = scrollRef.current; if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current; if (!el || !messages) return;
    if (messages.length !== lastCount.current && (stickToBottom.current || lastCount.current === 0)) el.scrollTop = el.scrollHeight;
    lastCount.current = messages.length;
  }, [messages]);

  const readTs = otherReadAt ? new Date(otherReadAt).getTime() : 0;
  const items: ReactNode[] = [];
  let lastDay = '';
  (messages ?? []).forEach((m, i) => {
    const day = dayLabel(m.created_at);
    if (day !== lastDay) { items.push(<div key={`d-${m.message_id}`} style={s.dayWrap}><span style={s.day}>{day}</span></div>); lastDay = day; }
    const mine = isMine(m);
    const prev = messages![i - 1];
    const grouped = !!prev && prev.sender_id === m.sender_id && dayLabel(prev.created_at) === day
      && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
    const read = mine && readTs >= new Date(m.created_at).getTime();
    items.push(
      <div key={m.message_id} className="msg-bubble-row" style={{ ...s.bubbleRow, justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: grouped ? 4 : 14 }}>
        {!mine && (grouped ? <span style={{ width: 36, flex: '0 0 36px' }} /> : <span style={{ ...avatar(36), ...roleAvatar(m.sender_role) }}>{initials(m.sender_name)}</span>)}
        <div style={{ maxWidth: 'min(72%, 560px)', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
          {!grouped && showSender(m) && <span style={s.senderName}>{senderLabel ? senderLabel(m) : m.sender_name}</span>}
          <div style={mine ? s.bubbleMine : s.bubbleTheirs}>
            <span style={s.bubbleText}>{m.body}</span>
            <span style={{ ...s.bubbleMeta, color: mine ? '#C9D6FF' : palette.slate400 }}>
              {timeOf(m.created_at)}
              {mine && <span title={read ? 'Read' : 'Sent'} aria-label={read ? 'Read' : 'Sent'} style={{ display: 'inline-flex', color: read ? '#8BE0B3' : '#C9D6FF' }}>{read ? <DoubleTickIcon /> : <TickIcon />}</span>}
            </span>
          </div>
        </div>
      </div>,
    );
  });

  return (
    <section className="msg-chat" style={{ ...s.card, ...s.chatCard }}>
      {header}
      <div ref={scrollRef} onScroll={onScroll} style={s.thread} aria-live="polite">
        {messages === null ? (
          <div style={s.threadCenter}><span style={s.spinner} aria-label="Loading messages" /></div>
        ) : messages.length === 0 ? (
          <div style={s.threadCenter}>
            <span style={s.emptyIcon}><ChatIcon /></span>
            <b style={{ color: palette.navy900, fontSize: 16 }}>{emptyTitle}</b>
            <span style={{ color: palette.slate500, fontSize: 14, maxWidth: 360, textAlign: 'center' }}>{emptyText}</span>
          </div>
        ) : items}
      </div>
      <Composer onSend={async (t) => { stickToBottom.current = true; await onSend(t); }} placeholder={placeholder} />
    </section>
  );
}

function Composer({ onSend, placeholder }: { onSend: (text: string) => Promise<void>; placeholder: string }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const trimmed = text.trim();
  const tooLong = text.length > MAX_LEN;
  async function submit() {
    if (!trimmed || busy || tooLong) return;
    setBusy(true); setErr(null);
    try { await onSend(trimmed); setText(''); ref.current?.focus(); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  }
  return (
    <div style={s.composerWrap}>
      {err && <div role="alert" style={{ ...box.err, margin: '0 0 10px' }}><AlertIcon /> <span>{err}</span></div>}
      <div style={s.composer}>
        <textarea ref={ref} rows={1} className="msg-compose" style={s.composeInput} value={text} placeholder={placeholder}
          aria-label="Message" maxLength={MAX_LEN + 200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
        <button type="button" className="msg-send" style={{ ...s.sendBtn, opacity: !trimmed || busy || tooLong ? 0.5 : 1 }}
          disabled={!trimmed || busy || tooLong} onClick={() => void submit()} aria-label="Send message" title="Send (Enter)">
          <SendIcon />
        </button>
      </div>
      <div style={s.composeHint}>
        <span>Enter to send · Shift + Enter for a new line</span>
        {text.length > MAX_LEN - 200 && <span style={{ color: tooLong ? '#B3352B' : palette.slate500, fontWeight: tooLong ? 700 : 500 }}>{text.length}/{MAX_LEN}</span>}
      </div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <ul style={s.inboxList} aria-label="Loading conversations">
      {[0, 1, 2].map((i) => (
        <li key={i} style={{ ...s.row, cursor: 'default' }}>
          <span className="msg-skel" style={{ ...avatar(46), background: palette.slate100 }} />
          <span style={{ flex: 1, display: 'grid', gap: 8 }}>
            <span className="msg-skel" style={{ height: 12, width: '40%', borderRadius: 6, background: palette.slate100 }} />
            <span className="msg-skel" style={{ height: 10, width: '70%', borderRadius: 6, background: palette.slate100 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function MsgStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      .msg-ui { font-family: 'Inter', system-ui, sans-serif; }
      .msg-ui * { box-sizing: border-box; }
      .msg-row { transition: background-color .12s ease; }
      .msg-row:hover { background: ${palette.white}; }
      .msg-row.is-active { background: ${palette.accentSoft} !important; box-shadow: inset 3px 0 0 ${palette.accent}; }
      .msg-row:focus-visible, .msg-chip:focus-visible, .msg-send:focus-visible, .msg-btn:focus-visible { outline: 3px solid ${palette.accentSoft}; outline-offset: 2px; }
      .msg-chip { transition: background-color .15s ease, color .15s ease; }
      .msg-chip:hover { filter: brightness(0.98); }
      .msg-btn, .msg-send { transition: filter .15s ease, transform .15s ease; }
      .msg-btn:hover, .msg-send:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
      .msg-menu-item:hover { background: ${palette.slate50}; }
      .msg-input:focus, .msg-compose:focus { outline: none; border-color: ${palette.accent} !important; box-shadow: 0 0 0 3px ${palette.accentSoft}; background: #fff !important; }
      .msg-bubble-row { animation: msgIn .18s ease; }
      @keyframes msgIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
      @keyframes msgSpin { to { transform: rotate(360deg); } }
      @keyframes msgPulse { 50% { opacity: .55; } }
      .msg-skel { animation: msgPulse 1.2s ease-in-out infinite; }
      @media (max-width: 980px) {
        .msg-split { grid-template-columns: 1fr !important; }
        .msg-side { display: none !important; }
      }
      @media (max-width: 620px) {
        .msg-glass { padding: 18px 12px 22px !important; border-radius: 18px !important; }
        .msg-chat { height: calc(100vh - 220px) !important; }
      }
      @media (prefers-reduced-motion: reduce) { .msg-bubble-row, .msg-skel { animation: none; } }
    `}</style>
  );
}

/* ---------- styles ---------- */
function avatar(size: number): React.CSSProperties {
  return {
    width: size, height: size, flex: `0 0 ${size}px`, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    font: `700 ${Math.round(size * 0.34)}px Inter, sans-serif`, background: palette.accentSoft, color: palette.accent,
  };
}
function roleAvatar(role: string): React.CSSProperties {
  if (role === 'COORDINATOR') return { background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentMid})`, color: '#fff' };
  if (role === 'EXTERNAL') return { background: '#FDEBD3', color: '#8A4B0F' };
  if (role === 'SUPER_ADMIN') return { background: '#EDE3F8', color: '#5B2A86' };
  return { background: palette.accentSoft, color: palette.accent };
}

const s = {
  page: {
    minHeight: '100%', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden',
    background: `radial-gradient(1100px 700px at 15% 0%, ${palette.navy800}aa 0%, transparent 60%),
                 radial-gradient(900px 600px at 100% 100%, ${palette.accent}22 0%, transparent 55%),
                 ${palette.navy900}`,
  } as const,
  blobA: { position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: `${palette.accent}1a`, top: -160, left: -140, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  blobB: { position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: `${palette.slate600}22`, bottom: -160, right: -120, filter: 'blur(30px)', pointerEvents: 'none' } as const,
  main: { position: 'relative', zIndex: 1, flex: 1, padding: '12px 24px 40px', width: '100%', maxWidth: 1240, margin: '0 auto', boxSizing: 'border-box' } as const,
  glassPanel: {
    position: 'relative', background: 'rgba(255,255,255,0.07)',
    backdropFilter: 'blur(22px) saturate(160%)', WebkitBackdropFilter: 'blur(22px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.16)', borderRadius: 24, padding: '24px 22px 24px',
    boxShadow: '0 24px 60px -32px rgba(3,22,54,0.75), inset 0 1px 0 rgba(255,255,255,0.10)',
  } as const,
  headRow: { marginBottom: 18 } as const,
  eyebrow: {
    display: 'inline-block', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    padding: '6px 14px', borderRadius: 999, marginBottom: 10,
    color: palette.slate100, background: `${palette.navy800}88`, border: `1px solid ${palette.slate400}55`,
  } as const,
  title: { fontSize: 28, fontWeight: 800, color: palette.white, margin: 0, letterSpacing: '-0.5px' } as const,
  subtitle: { fontSize: 14, color: palette.slate300, margin: '6px 0 0' } as const,

  card: { background: CARD_BG, border: `1px solid ${palette.slate300}e6`, borderRadius: 18, boxShadow: CARD_SHADOW, overflow: 'hidden' } as const,
  chatOnlyWrap: { maxWidth: 980, margin: '0 auto' } as const,
  split: { display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 16, alignItems: 'stretch' } as const,
  side: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 250px)', minHeight: 520 } as const,
  sideHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', fontSize: 16 } as const,
  unreadPill: { font: '700 11.5px Inter, sans-serif', color: '#fff', background: palette.red, borderRadius: 999, padding: '3px 9px' } as const,

  inboxBar: { display: 'flex', gap: 12, alignItems: 'center', padding: '16px 18px 10px', flexWrap: 'wrap' } as const,
  searchBox: { position: 'relative', flex: 1, minWidth: 220 } as const,
  searchIcon: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: palette.slate400, display: 'inline-flex' } as const,
  searchInput: { width: '100%', font: '14px Inter, sans-serif', padding: '11px 12px 11px 38px', border: `1.5px solid ${palette.slate300}`, borderRadius: 11, background: palette.slate50, color: palette.navy900 } as const,
  primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 8, background: palette.accent, color: '#fff', border: 'none', borderRadius: 11, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', boxShadow: '0 10px 20px -12px rgba(28,57,142,.9)' } as const,
  menu: { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 5, minWidth: 280, background: '#fff', border: `1px solid ${palette.slate300}`, borderRadius: 12, boxShadow: '0 18px 40px -18px rgba(3,22,54,.6)', padding: 6 } as const,
  menuItem: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px', border: 'none', background: 'transparent', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' } as const,
  filterRow: { display: 'flex', gap: 8, padding: '4px 18px 14px', flexWrap: 'wrap', borderBottom: `1px solid ${palette.slate300}` } as const,
  chipOn: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 999, padding: '7px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', background: palette.accent, color: '#fff' } as const,
  chipOff: { display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${palette.slate300}`, borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', color: palette.slate500 } as const,
  chipCount: { font: '700 11px Inter, sans-serif', background: palette.slate100, color: palette.navy900, borderRadius: 999, padding: '1px 7px' } as const,
  chipCountOn: { font: '700 11px Inter, sans-serif', background: 'rgba(255,255,255,.22)', color: '#fff', borderRadius: 999, padding: '1px 7px' } as const,

  inboxList: { listStyle: 'none', margin: 0, padding: 0 } as const,
  row: { display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '14px 18px', border: 'none', borderBottom: `1px solid ${palette.slate100}`, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' } as const,
  rowCompact: { padding: '12px 14px', gap: 11 } as const,
  avatarDot: { position: 'absolute', right: 0, bottom: 1, width: 12, height: 12, borderRadius: '50%', background: palette.red, boxShadow: '0 0 0 2px #fff' } as const,
  rowTop: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 } as const,
  rowName: { fontSize: 15, color: palette.navy900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const,
  rowTime: { fontSize: 12, whiteSpace: 'nowrap', flex: '0 0 auto' } as const,
  rowMeta: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, minWidth: 0 } as const,
  roleChip: { font: '700 11px Inter, sans-serif', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap', flex: '0 0 auto' } as const,
  rowDetail: { fontSize: 13, color: palette.slate500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const,
  rowBottom: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 5 } as const,
  rowPreview: { fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 } as const,
  countBadge: { flex: '0 0 auto', minWidth: 21, height: 21, padding: '0 6px', borderRadius: 999, background: palette.red, color: '#fff', font: '700 11.5px/21px Inter, sans-serif', textAlign: 'center' } as const,
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 20px', textAlign: 'center' } as const,
  emptyIcon: { width: 54, height: 54, borderRadius: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: palette.accentWash, color: palette.accent, marginBottom: 4 } as const,

  chatCard: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 250px)', minHeight: 520, background: '#fff' } as const,
  chatHead: { display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: `1px solid ${palette.slate100}`, background: '#fff' } as const,
  chatName: { fontSize: 17, fontWeight: 800, color: palette.navy900 } as const,
  chatDetail: { fontSize: 13.5, color: palette.slate500, marginTop: 2 } as const,
  thread: { flex: 1, overflowY: 'auto', padding: '8px 22px 18px', background: `linear-gradient(180deg, ${palette.slate50} 0%, #F1F5FD 100%)` } as const,
  threadCenter: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 } as const,
  spinner: { width: 28, height: 28, borderRadius: '50%', border: `3px solid ${palette.slate100}`, borderTopColor: palette.accent, animation: 'msgSpin .8s linear infinite' } as const,
  dayWrap: { display: 'flex', justifyContent: 'center', margin: '16px 0 4px' } as const,
  day: { font: '600 12px Inter, sans-serif', color: palette.slate500, background: '#fff', border: `1px solid ${palette.slate100}`, borderRadius: 999, padding: '4px 12px' } as const,
  bubbleRow: { display: 'flex', alignItems: 'flex-end', gap: 10 } as const,
  senderName: { fontSize: 12, fontWeight: 700, color: palette.slate500, margin: '0 4px 4px' } as const,
  bubbleMine: { background: `linear-gradient(135deg, ${palette.accentMid}, ${palette.accent})`, color: '#fff', borderRadius: '16px 16px 4px 16px', padding: '10px 14px 8px', boxShadow: '0 8px 18px -12px rgba(28,57,142,.9)' } as const,
  bubbleTheirs: { background: '#fff', color: palette.navy900, border: `1px solid ${palette.slate100}`, borderRadius: '16px 16px 16px 4px', padding: '10px 14px 8px', boxShadow: '0 6px 14px -12px rgba(3,22,54,.5)' } as const,
  bubbleText: { display: 'block', fontSize: 14.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const,
  bubbleMeta: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: 4, fontSize: 11.5 } as const,

  composerWrap: { padding: '12px 16px 12px', borderTop: `1px solid ${palette.slate100}`, background: '#fff' } as const,
  composer: { display: 'flex', alignItems: 'flex-end', gap: 10 } as const,
  composeInput: { flex: 1, resize: 'none', font: '14.5px/1.45 Inter, sans-serif', padding: '11px 14px', border: `1.5px solid ${palette.slate300}`, borderRadius: 14, background: palette.slate50, color: palette.navy900, maxHeight: 140 } as const,
  sendBtn: { flex: '0 0 46px', width: 46, height: 46, borderRadius: '50%', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: palette.accent, color: '#fff', boxShadow: '0 10px 20px -10px rgba(28,57,142,.95)' } as const,
  composeHint: { display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 6, fontSize: 11.5, color: palette.slate400 } as const,
};
const box = {
  err: { display: 'flex', gap: 9, alignItems: 'flex-start', background: '#FDECEC', color: '#8F2323', border: '1px solid #F3CACA', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: 14, lineHeight: 1.45 } as React.CSSProperties,
};

/* ---------- icons ---------- */
const ico = (size: number, d: ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>{d}</svg>
);
function SearchIcon() { return ico(16, <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></>); }
function SendIcon() { return ico(19, <><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4 18-7z" /></>); }
function TickIcon() { return ico(14, <path d="m5 12.5 4.5 4.5L19 7.5" />); }
function DoubleTickIcon() { return ico(16, <><path d="m2.5 12.5 4.5 4.5L16 8" /><path d="m11 16.5.5.5L21 7.5" /></>); }
function AlertIcon() { return ico(17, <><path d="M12 3.5 21.5 20h-19L12 3.5z" /><path d="M12 10v4.2" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></>); }
function ChatIcon() { return ico(24, <><path d="M4.5 5.5h15a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4.5 3.5V16.5h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" /><path d="M8 10h8M8 13h5" /></>); }
function InboxIcon() { return ico(24, <><path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-5.5z" /><path d="M3.5 13.5H9l1 2h4l1-2h5.5" /></>); }
function PeopleIcon() { return ico(22, <><circle cx="9" cy="8" r="3" /><path d="M3 20c.8-3.2 3-5 6-5s5.2 1.8 6 5" /><circle cx="17" cy="8.5" r="2.3" /><path d="M16 13.2c2.2.4 3.6 1.9 4.2 4.3" /></>); }
function ShieldIcon() { return ico(16, <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />); }
