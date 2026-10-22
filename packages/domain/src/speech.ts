// Voice-friendly number and money wording ("about thirty-four dollars").

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberToWords(n: number): string {
  const v = Math.floor(Math.abs(n));
  if (v < 20) return ONES[v] ?? String(v);
  if (v < 100) {
    const t = TENS[Math.floor(v / 10)] ?? '';
    return v % 10 ? `${t}-${ONES[v % 10]}` : t;
  }
  if (v < 1000) {
    const rest = v % 100;
    return `${ONES[Math.floor(v / 100)]} hundred${rest ? ` ${numberToWords(rest)}` : ''}`;
  }
  if (v < 1_000_000) {
    const rest = v % 1000;
    return `${numberToWords(Math.floor(v / 1000))} thousand${rest ? ` ${numberToWords(rest)}` : ''}`;
  }
  return String(v);
}

export const roundMoney = (n: number): number => Math.round(n * 100) / 100;

/** "34.48" -> "about thirty-four dollars" (approx) or "thirty-four dollars and forty-eight cents". */
export function spokenUsd(amount: number, mode: 'approx' | 'exact' = 'approx'): string {
  const value = roundMoney(amount);
  const dollars = Math.floor(value);
  const cents = Math.round((value - dollars) * 100);
  if (mode === 'approx') {
    const rounded = Math.round(value);
    const exact = cents === 0;
    return `${exact ? '' : 'about '}${numberToWords(rounded)} dollar${rounded === 1 ? '' : 's'}`;
  }
  const d = `${numberToWords(dollars)} dollar${dollars === 1 ? '' : 's'}`;
  return cents ? `${d} and ${numberToWords(cents)} cent${cents === 1 ? '' : 's'}` : d;
}

export const formatUsd = (amount: number): string => `$${roundMoney(amount).toFixed(2)}`;

/** Join items as "a, b and c". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
