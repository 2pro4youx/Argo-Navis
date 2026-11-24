import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { type DeviceEvent } from '../core/argoEngine';
import { hapticTap } from '../utils/haptics';

interface EventLogPanelProps {
  events: DeviceEvent[];
  onClear: () => void;
  className?: string;
}

type LogFilter = 'all' | 'pipeline' | 'user';

const PIPELINE_EVENTS = new Set<DeviceEvent['event']>([
  'ALERT_RECEIVED',
  'SIGNATURE_OK',
  'SIGNATURE_FAIL',
  'IN_REGION',
  'OUT_OF_REGION',
  'RESERVE_POWER_ACTIVE',
  'SIREN_ON',
  'ALL_CLEAR',
]);

const USER_EVENTS = new Set<DeviceEvent['event']>([
  'SLIDER_CONFIRMED',
  'NEAREST_SHELTER',
  'CHECKIN',
  'ESCALATED',
]);

function eventAccentColor(name: DeviceEvent['event']): string {
  switch (name) {
    case 'SIGNATURE_FAIL':
    case 'OUT_OF_REGION':
    case 'ESCALATED':
      return 'text-red-700 dark:text-red-400';
    case 'RESERVE_POWER_ACTIVE':
    case 'SIREN_ON':
      return 'text-amber-700 dark:text-amber-400';
    case 'SIGNATURE_OK':
    case 'IN_REGION':
    case 'CHECKIN':
    case 'ALL_CLEAR':
      return 'text-emerald-700 dark:text-emerald-400';
    default:
      return 'text-blue-700 dark:text-sky-400';
  }
}

export function EventLogPanel({ events, onClear, className = '' }: EventLogPanelProps) {
  const [filter, setFilter] = useState<LogFilter>('all');

  const visibleEvents = useMemo(() => {
    if (filter === 'all') return events;
    if (filter === 'pipeline') return events.filter((e) => PIPELINE_EVENTS.has(e.event));
    return events.filter((e) => USER_EVENTS.has(e.event));
  }, [events, filter]);

  return (
    <section
      className={`flex flex-col rounded-xl border border-slate-200 bg-white dark:border-[#1B2230] dark:bg-[#0C1017] ${className}`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2.5 sm:px-4 sm:py-3.5 dark:border-[#1B2230]">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-[#D4DCE6]">
            Device Event Stream
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
            POST /api/device/event · {events.length} logged
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            hapticTap();
            onClear();
          }}
          disabled={events.length === 0}
          aria-label="Clear event log"
          className="inline-flex min-h-[32px] sm:min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#222B3B] dark:bg-[#07090D] dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-[#131924] dark:hover:text-[#D4DCE6] whitespace-nowrap"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Clear</span>
        </button>
      </div>

      {/* Segmented filter buttons */}
      <div className="border-b border-slate-200 px-3 py-2 sm:px-4 sm:py-2.5 dark:border-[#1B2230]">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#07090D]">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'pipeline', label: 'Pipeline' },
              { id: 'user', label: 'User Actions' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                hapticTap();
                setFilter(tab.id);
              }}
              className={`rounded-md px-2 py-1 sm:py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-[#161D2B] dark:text-[#D4DCE6]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#D4DCE6]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chronological event feed */}
      <div
        data-testid="event-log-list"
        className="flex-1 divide-y divide-slate-100 overflow-y-auto px-4 dark:divide-[#151C28]"
      >
        {visibleEvents.length === 0 ? (
          <div className="flex h-full min-h-[160px] flex-col items-center justify-center px-4 py-6 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-[#C9D1DC]">
              No events recorded yet
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Broadcast an active alert or run a signature/geofence test on the left to watch each
              JSON step post in order.
            </p>
          </div>
        ) : (
          visibleEvents.map((ev) => (
            <div key={ev.id} className="py-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className={`font-mono text-xs font-bold ${eventAccentColor(ev.event)}`}>
                  {ev.event}
                </span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {ev.timestamp}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] break-all text-slate-700 dark:text-slate-300">
                {ev.detail}
              </p>
              <p className="mt-1 font-mono text-[10px] text-slate-500 tabular-nums">
                {`{"device":"${ev.device}","lat":${ev.lat},"lon":${ev.lon}}`}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
