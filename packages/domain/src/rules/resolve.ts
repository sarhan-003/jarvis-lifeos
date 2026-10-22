// Find a parcel from what the user said: a tracking number or a nickname
// like "my phone" or "the coffee machine delivery".
import type { Shipment } from '../schemas.js';
import { listJoin } from '../speech.js';
import { fail, ok, type RuleResult } from './result.js';

const FILLER = /\b(my|the|a|an|parcel|package|packages|delivery|order|shipment|box)\b/g;

export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
}

const singular = (w: string): string => w.replace(/(es|s)$/, '');

export function resolveShipment(shipments: Shipment[], query: string): RuleResult<Shipment> {
  const raw = query.trim();
  const byTracking = shipments.find((s) => s.trackingNumber.toLowerCase() === raw.toLowerCase());
  if (byTracking) return ok(byTracking);

  const q = normalizeQuery(raw);
  const nicknames = shipments.map((s) => s.nickname);
  if (!q) return fail(`Which parcel do you mean? You have ${listJoin(nicknames)}.`, nicknames);

  const exact = shipments.filter((s) => s.nickname.toLowerCase() === q);
  if (exact.length === 1 && exact[0]) return ok(exact[0]);

  const qWords = q.split(' ').map(singular);
  const matches = shipments.filter((s) => {
    const nick = s.nickname.toLowerCase();
    const item = s.itemDescription.toLowerCase();
    if (nick.includes(q) || q.includes(nick) || item.includes(q)) return true;
    const nickWords = nick.split(' ').map(singular);
    return qWords.some((w) => w.length > 2 && nickWords.includes(w));
  });

  if (matches.length === 1 && matches[0]) return ok(matches[0]);
  if (matches.length > 1) {
    const names = matches.map((s) => s.nickname);
    return fail(`"${raw}" could be your ${listJoin(names)}. Which one?`, names);
  }
  return fail(`I couldn't find a parcel called "${raw}". You have: ${listJoin(nicknames)}.`, nicknames);
}
