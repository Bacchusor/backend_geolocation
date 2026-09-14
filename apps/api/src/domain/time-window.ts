export interface WindowRule {
  window_start: string | null;
  window_end: string | null;
  days_of_week: number[];
}

export interface LocalTime {
  weekday: number; // 0 = Sunday … 6 = Saturday
  minutes: number; // minutes since local midnight
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local wall-clock time of `at` in IANA zone `tz`. */
export function localTime(at: Date, tz: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = WEEKDAYS[get('weekday')] ?? 0;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { weekday, minutes: hour * 60 + minute };
}

export const parseHHMM = (s: string): number => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * True when the rule's day-of-week list and (optional) daily time window contain `at`.
 * Windows may cross midnight (e.g. 22:00–06:00); the day-of-week check uses the window start day.
 */
export function isWithinWindow(
  rule: WindowRule,
  at: Date,
  tz: string,
): { ok: boolean; reason?: string } {
  const lt = localTime(at, tz);
  if (rule.window_start === null || rule.window_end === null) {
    if (!rule.days_of_week.includes(lt.weekday))
      return { ok: false, reason: `day ${lt.weekday} not in days_of_week` };
    return { ok: true };
  }
  const start = parseHHMM(rule.window_start);
  const end = parseHHMM(rule.window_end);
  if (start <= end) {
    if (!rule.days_of_week.includes(lt.weekday))
      return { ok: false, reason: `day ${lt.weekday} not in days_of_week` };
    const ok = lt.minutes >= start && lt.minutes < end;
    return ok ? { ok } : { ok, reason: `outside window ${rule.window_start}-${rule.window_end}` };
  }
  // Crosses midnight: [start, 24h) on day D or [0, end) on day D+1.
  if (lt.minutes >= start) {
    if (!rule.days_of_week.includes(lt.weekday))
      return { ok: false, reason: `day ${lt.weekday} not in days_of_week` };
    return { ok: true };
  }
  if (lt.minutes < end) {
    const prevDay = (lt.weekday + 6) % 7;
    if (!rule.days_of_week.includes(prevDay))
      return { ok: false, reason: `day ${prevDay} not in days_of_week` };
    return { ok: true };
  }
  return { ok: false, reason: `outside window ${rule.window_start}-${rule.window_end}` };
}

/** Start of the local calendar day containing `at`, as an instant. */
export function startOfLocalDay(at: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const secondsIntoDay = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
  return new Date(at.getTime() - secondsIntoDay * 1000 - (at.getTime() % 1000));
}
