/**
 * Coordinator — Equipment Alerts (EQUIP-AVAIL-13/14/15). Shows event
 * equipment allocations that locked at T-24hr with insufficient stock, and
 * lets the Coordinator swap in an available article. Reading this list also
 * opportunistically runs the lock-check and post-event-release polls
 * server-side, so it never gets more stale than a page load.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listAllocationAlerts, performSwap, type AllocationAlert } from './api.js';
import { listArticles, type Article } from '../inventory/api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function EquipmentAlertsScreen() {
  const { user, loading } = useAuth();
  const [alerts, setAlerts] = useState<AllocationAlert[] | null>(null);
  const [selected, setSelected] = useState<AllocationAlert | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await listAllocationAlerts(); setAlerts(r.alerts); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <PortalShell title="Equipment Alerts"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  return (
    <PortalShell title="Equipment Alerts" tint="slate">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {selected ? (
          <SwapPanel alert={selected} onBack={() => setSelected(null)}
            onDone={(m) => { setNotice(m); setError(null); setSelected(null); void load(); }} onError={setError} />
        ) : (
          <Panel title="Locked Allocations Needing Attention">
            {alerts === null ? <p style={muted}>Loading…</p> : alerts.length === 0 ? (
              <p style={muted}>Nothing needs attention. Every locked allocation has enough stock.</p>
            ) : (
              <table style={table}>
                <thead><tr><th style={th}>Equipment</th><th style={th}>Venue</th><th style={th}>Needed</th><th style={th}>Available</th><th style={th} /></tr></thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.allocation_id}>
                      <td style={td}>{a.equipment_type_name}</td>
                      <td style={td}>{a.venue_name}</td>
                      <td style={td}>{a.quantity}</td>
                      <td style={{ ...td, color: '#c0392b', fontWeight: 600 }}>{a.availableUnits}</td>
                      <td style={{ ...td, textAlign: 'right' }}><button style={reviewBtn} onClick={() => setSelected(a)}>Resolve</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        )}
      </div>
    </PortalShell>
  );
}

function SwapPanel({ alert, onBack, onDone, onError }: {
  alert: AllocationAlert; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [outgoingArticleId, setOutgoing] = useState('');
  const [incomingArticleId, setIncoming] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listArticles({ equipmentTypeId: alert.equipment_type_id }).then((r) => setArticles(r.articles)).catch(() => {});
  }, [alert.equipment_type_id]);

  const available = articles.filter((a) => a.state === 'AVAILABLE');

  async function submit() {
    if (!outgoingArticleId || !incomingArticleId) { onError('Select both the outgoing and incoming article.'); return; }
    setBusy(true);
    try {
      await performSwap(alert.allocation_id, { outgoingArticleId, incomingArticleId, reason: reason || undefined });
      onDone('Swap recorded. The Super Admin has been notified.');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Panel title={`Resolve — ${alert.equipment_type_name} at ${alert.venue_name}`}>
      <p style={{ ...muted, marginTop: 0 }}>
        Needed: {alert.quantity} · Currently available: {alert.availableUnits}. Swap an unavailable/damaged article for one that's ready.
      </p>
      <div style={formGrid}>
        <L label="Outgoing article (unavailable/damaged)">
          <select style={inp} value={outgoingArticleId} onChange={(e) => setOutgoing(e.target.value)}>
            <option value="">Select</option>
            {articles.map((a) => <option key={a.article_id} value={a.article_id}>{a.barcode} · {a.state}</option>)}
          </select>
        </L>
        <L label="Incoming article (available)">
          <select style={inp} value={incomingArticleId} onChange={(e) => setIncoming(e.target.value)}>
            <option value="">Select</option>
            {available.map((a) => <option key={a.article_id} value={a.article_id}>{a.barcode}</option>)}
          </select>
        </L>
        <div style={{ gridColumn: '1 / -1' }}>
          <L label="Reason (optional)"><input style={inp} value={reason} onChange={(e) => setReason(e.target.value)} /></L>
        </div>
      </div>
      <div style={actionRow}>
        <button style={acceptBtn} disabled={busy} onClick={submit}>{busy ? 'Recording…' : 'Confirm Swap'}</button>
        <button style={ghostBtn} onClick={onBack}>Back</button>
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}>{title}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={lbl}>{label}</span>{children}</label>;
}

const wrap: React.CSSProperties = { maxWidth: 780, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, maxWidth: 560, marginTop: 12 };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 14, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' };
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
};
