/**
 * Usage History — all roles (HIST-01..16).
 * Staff see full history across all users; clients see only their own.
 * Calls GET /api/history with query params for filtering.
 * Zero backend changes.
 */
import { useEffect, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import AppShell, { PageHeader, Card, Badge, EmptyState, ErrorBox, Th, Td, TableWrapper } from '../../components/AppShell.js';
import { api, ApiRequestError } from '../../lib/api.js';

function errMsg(e: unknown) { return e instanceof ApiRequestError ? e.body.error : 'Something went wrong.'; }

interface HistoryEntry {
  history_id: number;
  kind: 'VENUE_SESSION' | 'EQUIPMENT_BORROW';
  occurred_on: string;
  recorded_at: string;
  outcome: string;
  actor_user_id: string | null;
  actor_name?: string | null;
  venue_id: number | null;
  venue_name?: string | null;
  equipment_type_id: number | null;
  equipment_type_name?: string | null;
  sport_category_name?: string | null;
  entered_via_offline_fallback: boolean;
}

function listHistory(params: { kind?: string; from?: string; to?: string; outcome?: string }) {
  const q = new URLSearchParams();
  if (params.kind)    q.set('kind', params.kind);
  if (params.from)    q.set('from', params.from);
  if (params.to)      q.set('to', params.to);
  if (params.outcome) q.set('outcome', params.outcome);
  const qs = q.toString();
  return api<{ records: HistoryEntry[] }>(`/api/history${qs ? `?${qs}` : ''}`);
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function UsageHistoryScreen() {
  const { user, loading } = useAuth();
  const [records, setRecords] = useState<HistoryEntry[] | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  // Filters
  const [kind,    setKind]    = useState('');
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');
  const [outcome, setOutcome] = useState('');

  const load = useCallback(async () => {
    setRecords(null);
    try {
      const r = await listHistory({ kind: kind || undefined, from: from || undefined, to: to || undefined, outcome: outcome || undefined });
      setRecords(r.records);
    } catch (e) {
      setError(errMsg(e));
      setRecords([]);
    }
  }, [kind, from, to, outcome]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <AppShell title="Usage History"><p /></AppShell>;
  if (!user) return <Navigate to="/" replace />;

  const isStaff = user.role === 'SUPER_ADMIN' || user.role === 'COORDINATOR';

  return (
    <AppShell title="Usage History">
      <PageHeader
        title="Usage History"
        subtitle={isStaff ? 'Complete transaction record across all users' : 'Your completed bookings and borrows'}
      />
      {error && <ErrorBox message={error} />}

      {/* Filters */}
      <Card style={{ padding: 'var(--sp-4) var(--sp-5)', marginBottom: 'var(--sp-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={lbl}>Type</label>
            <select style={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All types</option>
              <option value="VENUE_SESSION">Venue bookings</option>
              <option value="EQUIPMENT_BORROW">Equipment borrows</option>
            </select>
          </div>
          <div>
            <label style={lbl}>From</label>
            <input style={sel} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>To</label>
            <input style={sel} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Outcome</label>
            <select style={sel} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">All outcomes</option>
              <option value="COMPLETED">Completed</option>
              <option value="COMPLETED_LATE">Completed (Late)</option>
              <option value="COMPLETED_DAMAGED">Completed (Damaged)</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          {(kind || from || to || outcome) && (
            <button style={clearBtn} onClick={() => { setKind(''); setFrom(''); setTo(''); setOutcome(''); }}>
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {/* Results */}
      <Card>
        {records === null ? (
          <div style={{ padding: 'var(--sp-6)', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading…</div>
        ) : records.length === 0 ? (
          <EmptyState
            title="No history records"
            body={kind || from || to || outcome ? 'Try adjusting your filters.' : 'Completed transactions appear here.'}
          />
        ) : (
          <TableWrapper>
            <thead>
              <tr>
                <th style={Th}>Date</th>
                <th style={Th}>Type</th>
                {isStaff && <th style={Th}>User</th>}
                <th style={Th}>Item</th>
                <th style={Th}>Outcome</th>
                <th style={Th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.history_id} style={{ borderBottom: '1px solid var(--line-light)' }}>
                  <td style={{ ...Td, whiteSpace: 'nowrap', fontSize: 13 }}>{fmt(r.occurred_on)}</td>
                  <td style={Td}>
                    <span style={{
                      font: '600 10px var(--font-mono)',
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: r.kind === 'VENUE_SESSION' ? 'var(--surface-alt)' : 'var(--teal-50)',
                      color: r.kind === 'VENUE_SESSION' ? 'var(--navy)' : 'var(--teal-700)',
                    }}>
                      {r.kind === 'VENUE_SESSION' ? 'Venue' : 'Borrow'}
                    </span>
                  </td>
                  {isStaff && (
                    <td style={{ ...Td, fontSize: 13 }}>{r.actor_name ?? <span style={{ color: 'var(--ink-faint)' }}>Guest</span>}</td>
                  )}
                  <td style={Td}>
                    {r.kind === 'VENUE_SESSION'
                      ? r.venue_name ?? '—'
                      : <span>{r.equipment_type_name ?? '—'}{r.sport_category_name ? <span style={{ color: 'var(--ink-faint)', fontSize: 12 }}> · {r.sport_category_name}</span> : null}</span>
                    }
                  </td>
                  <td style={Td}><Badge status={r.outcome} /></td>
                  <td style={Td}>
                    {r.entered_via_offline_fallback
                      ? <span style={{ font: '600 10px var(--font-mono)', padding: '2px 6px', borderRadius: 3, background: '#fff3e0', color: '#e65100' }}>OFFLINE</span>
                      : <span style={{ font: '10px var(--font-mono)', color: 'var(--ink-faint)' }}>live</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrapper>
        )}
      </Card>

      {records && records.length > 0 && (
        <p style={{ font: '12px var(--font-body)', color: 'var(--ink-faint)', marginTop: 'var(--sp-3)', textAlign: 'right' }}>
          {records.length} record{records.length !== 1 ? 's' : ''} · sorted newest first · read-only (HIST-05)
        </p>
      )}
    </AppShell>
  );
}

const lbl: React.CSSProperties = { display: 'block', font: '500 12px var(--font-body)', color: 'var(--ink-muted)', marginBottom: 4 };
const sel: React.CSSProperties = { font: '13.5px var(--font-body)', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--white)', color: 'var(--ink)', outline: 'none' };
const clearBtn: React.CSSProperties = { font: '13px var(--font-body)', padding: '7px 12px', background: 'none', border: '1px solid var(--line)', borderRadius: 'var(--radius)', cursor: 'pointer', color: 'var(--ink-muted)' };
