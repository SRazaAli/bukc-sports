/**
 * Coordinator + Admin — Active Borrows (BORROW-15..24). Redesigned with AppShell.
 * Backend unchanged: listActive, getTransaction, returnArticles.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { listActive, getTransaction, returnArticles, type ActiveBorrow, type TxnDetail } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }
function fmtDT(d: string) { return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }

export default function ActiveBorrowsScreen() {
  const { user, loading } = useAuth();
  const [rows,   setRows]   = useState<ActiveBorrow[] | null>(null);
  const [detail, setDetail] = useState<TxnDetail | null>(null);
  const [error,  setError]  = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows((await listActive()).transactions); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open(id: string) {
    try { setDetail(await getTransaction(id)); setError(null); } catch (e) { setError(errMsg(e)); }
  }

  if (loading) return <AppShell title="Active Borrows"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR' && user.role !== 'SUPER_ADMIN') return <Navigate to="/home" replace />;

  return (
    <AppShell title="Active Borrows">
      <PageHeader title="Active Borrows" subtitle="All equipment currently out — process returns here" />
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      {detail ? (
        <ReturnPanel txn={detail} onBack={() => setDetail(null)}
          onDone={(m) => { setNotice(m); setError(null); setDetail(null); void load(); }} onError={setError} />
      ) : (
        <Card style={{ padding: 'var(--sp-5)' }}>
          {rows === null ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
          : rows.length === 0 ? <EmptyState title="Nothing currently out" body="All equipment has been returned." />
          : (
            <TableWrapper>
              <thead><tr><th style={Th}>Borrower</th><th style={Th}>Equipment</th><th style={Th}>Due</th><th style={Th}>Status</th><th style={Th} /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.borrow_txn_id}>
                  <td style={Td}>{r.borrower_name ?? r.guest_name ?? '—'}</td>
                  <td style={Td}>{r.equipment_type_name}</td>
                  <td style={{ ...Td, whiteSpace: 'nowrap' }}>{fmtDT(r.agreed_return_at)}</td>
                  <td style={Td}><Badge status={r.status} /></td>
                  <td style={{ ...Td, textAlign: 'right' }}><Btn size="sm" onClick={() => open(r.borrow_txn_id)}>Process Return</Btn></td>
                </tr>
              ))}</tbody>
            </TableWrapper>
          )}
        </Card>
      )}
    </AppShell>
  );
}

function ReturnPanel({ txn, onBack, onDone, onError }: { txn: TxnDetail; onBack: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [mode,  setMode]  = useState<'scan'|'manual'|'dismiss'>('manual');
  const [score, setScore] = useState(80);
  const [busy,  setBusy]  = useState(false);

  const labelFor = (s: number) => s >= ((txn as any).good_min ?? 70) ? 'GOOD' : s >= ((txn as any).worn_min ?? 40) ? 'WORN' : 'DAMAGED';

  async function submit() {
    setBusy(true);
    try {
      const res = await returnArticles(txn.borrow_txn_id, {
        articleIds: txn.articles.map((a) => a.article_id), mode,
        ...(mode === 'manual' ? { score, label: labelFor(score) } : {}),
      });
      onDone(`Return processed — ${res.status}`);
    } catch (e) { onError(e instanceof ApiRequestError ? e.body.error : 'Could not process return.'); }
    finally { setBusy(false); }
  }

  const rows: Array<[string, string]> = [
    ['Borrower', txn.borrower_name ?? txn.guest_name ?? '—'],
    ['Equipment', txn.equipment_type_name],
    ['Started', fmtDT(txn.actual_start_at)],
    ['Due', fmtDT(txn.agreed_return_at)],
    ['Path', txn.path],
    ['Status', txn.status],
  ];

  return (
    <Card style={{ padding: 'var(--sp-5)', maxWidth: 600 }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', font: '13px var(--font-body)', padding: 0, marginBottom: 'var(--sp-4)' }}>← Back</button>
      <div style={{ font: '600 16px var(--font-display)', color: 'var(--navy)', marginBottom: 'var(--sp-4)' }}>Process Return</div>

      <div style={{ marginBottom: 'var(--sp-4)' }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', padding: '8px 0', borderBottom: '1px solid var(--line-light)' }}>
            <span style={{ font: '500 13px var(--font-body)', color: 'var(--ink-muted)' }}>{k}</span>
            <span style={{ font: '14px var(--font-body)', color: 'var(--ink)' }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <label style={lbl}>Return mode</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['manual','scan','dismiss'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{ padding: '7px 16px', borderRadius: 'var(--radius)', border: `2px solid ${mode === m ? 'var(--teal)' : 'var(--line)'}`, background: mode === m ? 'var(--teal-50)' : 'var(--white)', color: mode === m ? 'var(--teal-700)' : 'var(--ink-muted)', font: '13px var(--font-body)', cursor: 'pointer', fontWeight: mode === m ? 600 : 400 }}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {mode === 'manual' && (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <label style={lbl}>Condition score: <strong>{score}</strong> — {labelFor(score)}</label>
          <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} style={{ width: '100%' }} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        <Btn onClick={submit} loading={busy}>Confirm Return</Btn>
        <Btn variant="secondary" onClick={onBack}>Cancel</Btn>
      </div>
    </Card>
  );
}

const lbl: React.CSSProperties = { display: 'block', font: '500 12.5px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 8 };
