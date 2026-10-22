// Calendar helpers. Dates are "YYYY-MM-DD" in the server's local calendar.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return isoDate(parseIsoDate(value)) === value;
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function weekday(iso: string): string {
  const name = WEEKDAYS[parseIsoDate(iso).getDay()] ?? 'sunday';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Resolve "today", "tomorrow", "saturday", "next monday", "in 3 days" or an ISO date. */
export function resolveDate(phrase: string, today: string): string | null {
  const p = phrase.trim().toLowerCase();
  if (isIsoDate(p)) return p;
  if (p === 'today' || p === 'tonight') return today;
  if (p === 'tomorrow') return addDays(today, 1);
  if (p === 'day after tomorrow') return addDays(today, 2);
  const inDays = /^in (\d+) days?$/.exec(p);
  if (inDays) return addDays(today, Number(inDays[1]));
  const wd = /^(?:next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(p);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1] as (typeof WEEKDAYS)[number]);
    const current = parseIsoDate(today).getDay();
    const diff = (target - current + 7) % 7 || 7;
    return addDays(today, diff);
  }
  return null;
}

/** "today", "tomorrow", "Saturday", or "October 27" relative to today. */
export function spokenDay(iso: string, today: string): string {
  if (iso === today) return 'today';
  if (iso === addDays(today, 1)) return 'tomorrow';
  if (iso === addDays(today, -1)) return 'yesterday';
  const diff = Math.round((parseIsoDate(iso).getTime() - parseIsoDate(today).getTime()) / 86_400_000);
  if (diff > 1 && diff < 7) return weekday(iso);
  const d = parseIsoDate(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Local time like "2:32 PM" from an ISO timestamp. */
export function spokenTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}
