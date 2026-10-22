// Calendar-date helpers. Dates are plain "YYYY-MM-DD" strings in the user's
// local calendar; the client sends its local "today" with every request so the
// server never guesses the user's timezone.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso) {
  return WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Resolve "today", "tomorrow", "monday", "next friday", "in 3 days" or an ISO
// date relative to `today`. Returns null when the phrase is not a date.
export function resolveDate(phrase, today) {
  if (!phrase) return null;
  const p = String(phrase).trim().toLowerCase();
  if (isIsoDate(p)) return p;
  if (p === 'today' || p === 'tonight') return today;
  if (p === 'tomorrow') return addDays(today, 1);
  if (p === 'day after tomorrow') return addDays(today, 2);
  if (p === 'yesterday') return addDays(today, -1);
  const inDays = p.match(/^in (\d+) days?$/);
  if (inDays) return addDays(today, Number(inDays[1]));
  if (p === 'next week') return addDays(today, 7);
  const wd = p.match(/^(?:next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    const current = new Date(`${today}T00:00:00Z`).getUTCDay();
    let diff = (target - current + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(today, diff);
  }
  return null;
}

// "HH:MM" <-> minutes since midnight
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
