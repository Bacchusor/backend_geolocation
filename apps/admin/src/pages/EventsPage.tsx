import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EVENT_OUTCOMES, type RuleEvent } from '@georeminder/shared';
import { api } from '../api';
import { Badge, fmtDate } from '../components/ui';

const outcomeKind: Record<string, 'ok' | 'warn' | 'err' | 'info' | undefined> = {
  notified: 'ok',
  skipped: 'warn',
  failed: 'err',
  transition: 'info',
  ignored: undefined,
};

export function EventsPage() {
  const [filters, setFilters] = useState({ person: '', place: '', outcome: '', from: '', to: '' });
  const [beforeId, setBeforeId] = useState<number | undefined>();
  const places = useQuery({ queryKey: ['places'], queryFn: api.places.list });
  const events = useQuery({
    queryKey: ['events', filters, beforeId],
    queryFn: () =>
      api.events.list({
        person: filters.person || undefined,
        place: filters.place || undefined,
        outcome: filters.outcome || undefined,
        from: filters.from ? new Date(filters.from).toISOString() : undefined,
        to: filters.to ? new Date(filters.to).toISOString() : undefined,
        before_id: beforeId,
        limit: 100,
      }),
    refetchInterval: beforeId ? false : 15_000,
  });
  const persons = useQuery({ queryKey: ['persons'], queryFn: api.persons.list });
  const set = (k: keyof typeof filters, v: string) => {
    setFilters({ ...filters, [k]: v });
    setBeforeId(undefined);
  };

  return (
    <div className="page">
      <div className="row">
        <h2 className="page-title">Event log</h2>
        <span className="small muted">
          every evaluation and notification, with the reason it did or did not fire · auto-refresh
          15 s
        </span>
      </div>
      <div className="panel row">
        <label>
          <span>Person</span>
          <select value={filters.person} onChange={(e) => set('person', e.target.value)}>
            <option value="">all</option>
            {persons.data?.items.map((p) => (
              <option key={p.person} value={p.person}>
                {p.person}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Place</span>
          <select value={filters.place} onChange={(e) => set('place', e.target.value)}>
            <option value="">all</option>
            {places.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Outcome</span>
          <select value={filters.outcome} onChange={(e) => set('outcome', e.target.value)}>
            <option value="">all</option>
            {EVENT_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>From</span>
          <input
            type="datetime-local"
            value={filters.from}
            onChange={(e) => set('from', e.target.value)}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(e) => set('to', e.target.value)}
          />
        </label>
        <div className="spacer" />
        <button className="btn" onClick={() => void events.refetch()}>
          Refresh
        </button>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Person</th>
              <th>Place</th>
              <th>Rule / trigger</th>
              <th>Outcome</th>
              <th>Why</th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            {events.data?.items.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
            {events.data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No events.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 8 }}>
          {beforeId && (
            <button className="btn sm" onClick={() => setBeforeId(undefined)}>
              ⇤ Latest
            </button>
          )}
          {events.data?.next_before_id && (
            <button className="btn sm" onClick={() => setBeforeId(events.data!.next_before_id!)}>
              Older →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EventRow({ e }: { e: RuleEvent }) {
  return (
    <tr>
      <td className="small" style={{ whiteSpace: 'nowrap' }}>
        {fmtDate(e.created_at)}
        <div className="muted">{e.source}</div>
      </td>
      <td className="mono">{e.person}</td>
      <td>
        {e.place_name ?? <span className="muted">—</span>}
        {e.distance_m !== null && <div className="small muted">{Math.round(e.distance_m)} m</div>}
      </td>
      <td className="small">
        {e.rule_name ?? <span className="muted">—</span>}
        {e.trigger && <div className="muted">{e.trigger}</div>}
      </td>
      <td>
        <Badge kind={outcomeKind[e.outcome]}>{e.outcome}</Badge>
      </td>
      <td className="small">
        {e.reason}
        {e.delivery && (
          <details>
            <summary>delivery</summary>
            <pre className="mono">{JSON.stringify(e.delivery, null, 2)}</pre>
          </details>
        )}
      </td>
      <td className="small">{e.matched_items.join(', ')}</td>
    </tr>
  );
}
