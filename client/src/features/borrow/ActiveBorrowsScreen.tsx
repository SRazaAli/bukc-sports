/**
 * Coordinator — Active Borrows (BORROW-15..24). Lists ACTIVE / OVERDUE /
 * INCOMPLETE transactions; processing a return offers the three modes
 * (scan / manual / dismiss) matching BORROW-22.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { PortalShell } from '../auth/PortalShell.js';
import { listActive, getTransaction, returnArticles, type ActiveBorrow, type TxnDetail } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function ActiveBorrowsScreen() {
  const { user, loading } = useAuth();
  const [rows, setRows] = useState<ActiveBorrow[] | null>(null);
  const [detail, setDetail] = useState<TxnDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await listActive(); setRows(r.transactions); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open(txnId: string) {
    try { setDetail(await getTransaction(txnId)); setError(null); } catch (e) { setError(errMsg(e)); }
  }

  if (loading) return <PortalShell title="Active Borrows"><p /></PortalShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR' && user.role !== 'SUPER_ADMIN') return <Navigate to="/home" replace />;

  const stateBadge = (s: string) => s === 'OVERDUE' ? badge.danger : s === 'INCOMPLETE' ? badge.warn : badge.ok;

  return (
    <PortalShell title="Active Borrows" tint="slate">
      <div style={wrap}>
        {error && <div style={box.err}>{error}</div>}
        {notice && <div style={box.ok}>{notice}</div>}

        {detail ? (
          <ReturnPanel txn={detail} onBack={() => setDetail(null)}
            onDone={(m) => { setNotice(m); setError(null); setDetail(null); void load(); }} onError={setError} />
        ) : (
          <Panel title="Currently Out">
            {rows === null ? <p style={muted}>Loading…</p> : rows.length === 0 ? (
              <p style={muted}>Nothing is currently borrowed.</p>
            ) : (
              <table style={table}>
                <thead><tr><th style={th}>Borrower</th><th style={th}>Equipment</th><th style={th}>Due</th><th style={th}>Status</th><th style={th} /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.borrow_txn_id}>
                      <td style={td}>{r.borrower_name ?? r.guest_name ?? '—'}</td>
                      <td style={td}>{r.equipment_type_name}</td>
                      <td style={td}>{new Date(r.agreed_return_at).toLocaleString()}</td>
                      <td style={td}><span style={{ ...badgeBase, ...stateBadge(r.status) }}>{r.status}</span></td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button style={reviewBtn} onClick={() => open(r.borrow_txn_id)}>Process Return</button>
                      </td>
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

function ReturnPanel({ txn, onBack, onDone, onError }: {
  txn: TxnDetail; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const outstanding = txn.articles.filter((a) => !a.returned_at);
  const [selectedIds, setSelectedIds] = useState<string[]>(outstanding.map((a) => a.article_id));
  const [mode, setMode] = useState<'scan' | 'manual' | 'dismiss'>('scan');
  const [score, setScore] = useState(90);
  const [label, setLabel] = useState<'GOOD' | 'WORN' | 'DAMAGED'>('GOOD');
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelectedIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }

  async function submit() {
    if (selectedIds.length === 0) { onError('Select at least one article being returned.'); return; }
    setBusy(true);
    try {
      const res = await returnArticles(txn.borrow_txn_id, {
        articleIds: selectedIds, mode,
        score: mode === 'scan' ? score : undefined,
        label: mode === 'manual' ? label : undefined,
      });
      onDone(`Return processed — ${res.status.replace('_', ' ').toLowerCase()}.`);
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <Panel title={`Return — ${txn.borrower_name ?? txn.guest_name ?? 'Borrower'}`}>
      <p style={{ ...muted, marginTop: 0 }}>{txn.equipment_type_name} · agreed return {new Date(txn.agreed_return_at).toLocaleString()}</p>

      <div style={{ marginBottom: 16 }}>
        <span style={lbl}>Articles being returned</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {outstanding.map((a) => (
            <label key={a.article_id} style={checkRow}>
              <input type="checkbox" checked={selectedIds.includes(a.article_id)} onChange={() => toggle(a.article_id)} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>{a.barcode}</span>
            </label>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <span style={lbl}>Condition check</span>
        <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
          {(['scan', 'manual', 'dismiss'] as const).map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              {m === 'scan' ? 'Health scan' : m === 'manual' ? 'Manual condition' : 'Dismiss (skip check)'}
            </label>
          ))}
        </div>
      </div>

      {mode === 'scan' && (
        <L label="Health score (0–100)"><input type="number" style={inp} value={score} onChange={(e) => setScore(Number(e.target.value))} /></L>
      )}
      {mode === 'manual' && (
        <L label="Condition"><select style={inp} value={label} onChange={(e) => setLabel(e.target.value as 'GOOD' | 'WORN' | 'DAMAGED')}>
          <option value="GOOD">Good</option><option value="WORN">Worn</option><option value="DAMAGED">Damaged</option>
        </select></L>
      )}
      {mode === 'dismiss' && (
        <div style={box.warn}>Skipping the check leaves this article's condition unverified. A warning stays in the notification center until reviewed.</div>
      )}

      <div style={actionRow}>
        <button style={acceptBtn} disabled={busy} onClick={submit}>{busy ? 'Processing…' : 'Confirm Return'}</button>
        <button style={ghostBtn} onClick={onBack}>Back</button>
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={panel}><div style={panelHead}>{title}</div><div style={panelBody}>{children}</div></section>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', maxWidth: 260 }}><span style={lbl}>{label}</span>{children}</label>;
}

const wrap: React.CSSProperties = { maxWidth: 860, margin: '0 auto' };
const panel: React.CSSProperties = { background: '#fff', border: '1px solid #ddd', borderRadius: 4, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' };
const panelHead: React.CSSProperties = { padding: '12px 18px', borderBottom: '1px solid #e5e5e5', font: '600 15px var(--font-body)', color: '#333', background: 'linear-gradient(#fff,#f7f7f7)' };
const panelBody: React.CSSProperties = { padding: 18 };
const table: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const th: React.CSSProperties = { textAlign: 'left', font: '600 11px var(--font-body)', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 8px 8px', borderBottom: '1px solid #e5e5e5' };
const td: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', color: '#333' };
const muted: React.CSSProperties = { color: '#5c6773', fontSize: 14.5, margin: 0 };
const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: '#26485f', marginBottom: 5 };
const inp: React.CSSProperties = { width: '100%', font: '14px var(--font-body)', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4 };
const reviewBtn: React.CSSProperties = { background: '#0a6ebd', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 14, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { background: '#fff', color: '#555', border: '1px solid #ccc', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const acceptBtn: React.CSSProperties = { background: '#1f8a4c', color: '#fff', border: 'none', borderRadius: 4, padding: '9px 18px', fontSize: 14.5, cursor: 'pointer' };
const actionRow: React.CSSProperties = { display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' };
const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 };
const badgeBase: React.CSSProperties = { font: '600 11px var(--font-mono)', padding: '2px 7px', borderRadius: 4 };
const badge = {
  ok: { background: '#e6f4ec', color: '#1f7a45' } as React.CSSProperties,
  warn: { background: '#fdf1e3', color: '#9a6412' } as React.CSSProperties,
  danger: { background: '#fbe9e7', color: '#b3352b' } as React.CSSProperties,
};
const box = {
  err: { background: '#fdecec', color: '#8f2323', border: '1px solid #f3caca', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  ok: { background: '#eaf6ee', color: '#1e6b3a', border: '1px solid #c2e6cd', borderRadius: 4, padding: '10px 14px', marginBottom: 16, fontSize: 14 } as React.CSSProperties,
  warn: { background: '#fdf1e3', color: '#9a6412', border: '1px solid #f3d3ba', borderRadius: 4, padding: '10px 14px', fontSize: 13.5, marginBottom: 12 } as React.CSSProperties,
};
