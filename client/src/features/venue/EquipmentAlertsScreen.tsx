/**
 * Coordinator — Equipment Alerts (event equipment shortfalls). Redesigned with AppShell.
 * Backend unchanged: listAllocationAlerts, performSwap.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Btn, Badge, EmptyState, ErrorBox, SuccessBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { listAllocationAlerts, performSwap, type AllocationAlert } from './api.js';
import { ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

export default function EquipmentAlertsScreen() {
  const { user, loading } = useAuth();
  const [alerts, setAlerts] = useState<AllocationAlert[] | null>(null);
  const [error,  setError]  = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setAlerts((await listAllocationAlerts()).alerts); } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="Equipment Alerts"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'COORDINATOR') return <Navigate to="/home" replace />;

  return (
    <AppShell title="Equipment Alerts">
      <PageHeader title="Equipment Alerts" subtitle="Shortfalls and swap requests for upcoming venue events" />
      {error  && <ErrorBox message={error} />}
      {notice && <SuccessBox message={notice} />}

      <Card style={{ padding: 'var(--sp-5)' }}>
        {alerts === null ? <p style={{ color: 'var(--ink-muted)' }}>Loading…</p>
        : alerts.length === 0 ? <EmptyState title="No equipment alerts" body="All event equipment allocations are satisfied." />
        : (
          <TableWrapper>
            <thead><tr><th style={Th}>Equipment</th><th style={Th}>Venue</th><th style={Th}>Requested</th><th style={Th}>Available</th><th style={Th} /></tr></thead>
            <tbody>{alerts.map((a) => (
              <tr key={a.allocation_id}>
                <td style={Td}>{a.equipment_type_name}</td>
                <td style={Td}>{a.venue_name}</td>
                <td style={Td}>{a.quantity}</td>
                <td style={Td}>
                  <span style={{ font: '600 14px var(--font-display)', color: a.availableUnits < a.quantity ? 'var(--danger)' : 'var(--ok)' }}>
                    {a.availableUnits}
                  </span>
                </td>
                <td style={{ ...Td, textAlign: 'right' }}>
                  <SwapPanel alert={a} onDone={(m) => { setNotice(m); setError(null); void load(); }} onError={setError} />
                </td>
              </tr>
            ))}</tbody>
          </TableWrapper>
        )}
      </Card>
    </AppShell>
  );
}

function SwapPanel({ alert, onDone, onError }: { alert: AllocationAlert; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [open,    setOpen]    = useState(false);
  const [outId,   setOutId]   = useState('');
  const [inId,    setInId]    = useState('');
  const [reason,  setReason]  = useState('');
  const [busy,    setBusy]    = useState(false);

  async function submit() {
    if (!outId.trim() || !inId.trim()) { onError('Enter both article IDs for the swap.'); return; }
    setBusy(true);
    try {
      await performSwap(alert.allocation_id, { outgoingArticleId: outId.trim(), incomingArticleId: inId.trim(), reason: reason.trim() || undefined });
      onDone('Article swap recorded.');
      setOpen(false); setOutId(''); setInId(''); setReason('');
    } catch (e) { onError(errMsg(e)); } finally { setBusy(false); }
  }

  if (!open) return <Btn size="sm" variant="secondary" onClick={() => setOpen(true)}>Swap Article</Btn>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200, alignItems: 'flex-end' }}>
      <input placeholder="Outgoing article ID" value={outId} onChange={(e) => setOutId(e.target.value)} style={inp} />
      <input placeholder="Incoming article ID" value={inId}  onChange={(e) => setInId(e.target.value)}  style={inp} />
      <input placeholder="Reason (optional)"   value={reason} onChange={(e) => setReason(e.target.value)} style={inp} />
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn size="sm" onClick={submit} loading={busy}>Confirm</Btn>
        <Btn size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { font: '12.5px var(--font-body)', padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', outline: 'none', width: '100%' };
