import { describe, expect, it } from 'vitest';
import {
  InMemoryShipmentStore,
  ParcelConcierge,
  addDays,
  calculateDuty,
  createSlots,
  isoDate,
  resolveDate,
  resolveShipment,
  spokenUsd,
  weekday,
} from '../src/index.js';

// Pin "now" to a Thursday afternoon so relative dates are predictable.
const NOW = new Date(2026, 9, 22, 13, 0, 0);
const TODAY = isoDate(NOW);

function setup() {
  const store = new InMemoryShipmentStore(() => NOW);
  let n = 0;
  const svc = new ParcelConcierge(store, { newReference: (k) => `SLX-${k}-${String(++n).padStart(k === 'PAY' ? 6 : 5, '0')}` });
  return { store, svc };
}

describe('seed data', () => {
  it('seeds six parcels with dates relative to now', () => {
    const { store } = setup();
    const byNick = Object.fromEntries(store.listShipments().map((s) => [s.nickname, s]));
    expect(Object.keys(byNick).sort()).toEqual(['books', 'coffee machine', 'headphones', 'laptop stand', 'phone', 'running shoes']);
    expect(byNick['running shoes']?.eta).toBe(TODAY);
    expect(byNick['books']?.eta).toBe(addDays(TODAY, 3));
    expect(byNick['headphones']?.proofOfDelivery?.deliveredAt.startsWith(addDays(TODAY, -1).slice(0, 7))).toBe(true);
    expect(byNick['phone']?.status).toBe('CustomsHold');
    for (const s of store.listShipments()) {
      expect(s.trackingNumber).toMatch(/^SLX\d{10}$/);
      expect(s.events.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('works when "now" is a different day', () => {
    const later = new Date(2027, 0, 5, 9);
    const store = new InMemoryShipmentStore(() => later);
    expect(store.listShipments().find((s) => s.nickname === 'running shoes')?.eta).toBe(isoDate(later));
  });

  it('creates deterministic slots with Saturday evening available', () => {
    const a = createSlots(NOW);
    const b = createSlots(NOW);
    expect(a).toEqual(b);
    expect(a).toHaveLength(21);
    const unavailable = a.filter((s) => !s.available).length;
    expect(unavailable).toBeGreaterThan(0);
    expect(unavailable).toBeLessThan(12);
    const sat = a.find((s) => weekday(s.date) === 'Saturday' && s.window === 'evening');
    expect(sat?.available).toBe(true);
  });
});

describe('resolveShipment', () => {
  const { store } = setup();
  const all = store.listShipments();

  it('matches tracking numbers, nicknames and natural phrases', () => {
    expect(resolveShipment(all, 'SLX4820193756')).toMatchObject({ ok: true, value: { nickname: 'phone' } });
    expect(resolveShipment(all, 'my phone')).toMatchObject({ ok: true, value: { nickname: 'phone' } });
    expect(resolveShipment(all, 'the coffee machine delivery')).toMatchObject({ ok: true, value: { nickname: 'coffee machine' } });
    expect(resolveShipment(all, 'shoes')).toMatchObject({ ok: true, value: { nickname: 'running shoes' } });
    expect(resolveShipment(all, 'Headphones parcel')).toMatchObject({ ok: true, value: { nickname: 'headphones' } });
  });

  it('lists available nicknames when nothing matches', () => {
    const r = resolveShipment(all, 'tv');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('couldn\'t find a parcel called "tv"');
      expect(r.candidates).toContain('phone');
    }
  });

  it('asks which one when several match', () => {
    const extra = [...all, { ...all[0]!, id: 'x', nickname: 'phone case', trackingNumber: 'SLX0000000000' }];
    const r = resolveShipment(extra, 'phone stuff');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates).toEqual(['phone', 'phone case']);
  });
});

describe('customs', () => {
  it('calculates duty: value x rate + fee', () => {
    expect(calculateDuty(899, 2.5, 12)).toEqual({ declaredValueUsd: 899, ratePercent: 2.5, duty: 22.48, fee: 12, total: 34.48 });
  });

  it('speaks money for voice', () => {
    expect(spokenUsd(34.48)).toBe('about thirty-four dollars');
    expect(spokenUsd(34.48, 'exact')).toBe('thirty-four dollars and forty-eight cents');
    expect(spokenUsd(12, 'exact')).toBe('twelve dollars');
  });

  it('explains the hold in plain English', () => {
    const { svc } = setup();
    const r = svc.getCustomsStatus('my phone');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.holdReasons.map((h) => h.code)).toEqual(['DOC_MISSING_INVOICE', 'DUTY_UNPAID']);
    expect(r.data.duty?.total).toBe(34.48);
    expect(r.speech).toContain('commercial invoice');
  });

  it('never pays without confirm=true', () => {
    const { svc, store } = setup();
    const quote = svc.payCustomsDuty('phone', false);
    expect(quote.ok && quote.data.confirmed).toBe(false);
    expect(quote.speech).toContain('Should I pay it?');
    expect(quote.speech).toContain('thirty-four dollars and forty-eight cents');
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(false);

    const paid = svc.payCustomsDuty('phone', true);
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.paymentReference).toBe('SLX-PAY-000001');
    expect(paid.data.remainingBlockers).toEqual(['commercial invoice']);
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(true);
    expect(store.getShipment('shp_phone')?.status).toBe('CustomsHold');

    expect(svc.payCustomsDuty('phone', true).ok).toBe(false); // already paid
  });

  it('releases the parcel once duty is paid and the invoice received', () => {
    const { svc, store } = setup();
    svc.payCustomsDuty('phone', true);
    const doc = svc.uploadCustomsDocument('phone', 'commercial_invoice');
    expect(doc.ok).toBe(true);
    const phone = store.getShipment('shp_phone');
    expect(phone?.status).toBe('ArrivedInCountry');
    expect(phone?.eta).toBe(addDays(TODAY, 1));
    expect(phone?.events.at(-1)?.code).toBe('CUSTOMS_RELEASED');
  });

  it('refuses documents customs is not waiting for', () => {
    const { svc } = setup();
    expect(svc.uploadCustomsDocument('phone', 'id_proof').ok).toBe(false);
    expect(svc.uploadCustomsDocument('books', 'commercial_invoice').ok).toBe(false);
  });
});

describe('delivery', () => {
  it('reschedules to an available slot, using weekday words', () => {
    const { svc, store } = setup();
    const r = svc.rescheduleDelivery('books', 'saturday', 'evening');
    expect(r.ok).toBe(true);
    const books = store.getShipment('shp_books');
    expect(books?.eta).toBe(resolveDate('saturday', TODAY));
    expect(books?.deliveryWindow).toBe('evening');
  });

  it('rejects unavailable slots and non-reschedulable parcels', () => {
    const { svc, store } = setup();
    const full = store.listSlots().find((s) => !s.available)!;
    expect(svc.rescheduleDelivery('books', full.date, full.window).ok).toBe(false);
    expect(svc.rescheduleDelivery('headphones', 'saturday', 'evening').ok).toBe(false);
    expect(svc.rescheduleDelivery('phone', 'saturday', 'evening').ok).toBe(false);
    expect(svc.rescheduleDelivery('laptop stand', 'saturday', 'evening').ok).toBe(false);
  });

  it('offers at most nine available slots', () => {
    const { svc } = setup();
    const r = svc.getDeliverySlots('books');
    expect(r.ok && r.data.slots.length).toBeLessThanOrEqual(9);
    expect(r.ok && r.data.slots.every((s) => s.available)).toBe(true);
  });

  it('leaves parcels with the neighbour on file', () => {
    const { svc, store } = setup();
    const r = svc.updateDeliveryInstructions('running shoes', 'neighbour', 'Sam next door');
    expect(r.ok).toBe(true);
    expect(store.getShipment('shp_shoes')?.deliveryInstructions).toBe('Leave with Sam in 4B');
  });

  it('address correction fixes the delivery exception', () => {
    const { svc, store } = setup();
    const r = svc.updateDeliveryInstructions('coffee machine', 'address_correction', 'my unit is 12B');
    expect(r.ok).toBe(true);
    const coffee = store.getShipment('shp_coffee');
    expect(coffee?.status).toBe('InTransit');
    expect(coffee?.destination).toContain('Unit 12B');
    expect(coffee?.eta).toBe(addDays(TODAY, 1));
  });
});

describe('returns', () => {
  it('books a return pickup for a delivered parcel inside the window', () => {
    const { svc, store } = setup();
    const pod = svc.getProofOfDelivery('headphones');
    expect(pod.ok && pod.data.leftAt).toBe('front door');
    const r = svc.requestReturnPickup('headphones', 'Not comfortable', 'tomorrow', 'morning');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.id).toBe('SLX-RET-00001');
    expect(store.getShipment('shp_headphones')?.status).toBe('ReturnRequested');
    expect(store.listReturns()).toHaveLength(1);
  });

  it('refuses returns for undelivered parcels and past windows', () => {
    const { svc } = setup();
    expect(svc.requestReturnPickup('books', 'x', 'tomorrow', 'morning').ok).toBe(false);
    const late = new InMemoryShipmentStore(() => NOW);
    const headphones = late.getShipment('shp_headphones')!;
    late.saveShipment({ ...headphones, returnEligibleUntil: addDays(TODAY, -1) });
    expect(new ParcelConcierge(late).requestReturnPickup('headphones', 'x', 'tomorrow', 'morning').ok).toBe(false);
  });
});

describe('listing', () => {
  it('lists parcels on the way, soonest first, and flags problems', () => {
    const { svc } = setup();
    const r = svc.listActiveShipments();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.shipments.map((s) => s.nickname)).not.toContain('headphones');
    expect(r.data.shipments[0]?.nickname).toBe('running shoes');
    expect(r.speech).toMatch(/^You have five parcels on the way\./);
    expect(r.speech).toContain('held in customs');
  });

  it('reset restores the seed', () => {
    const { svc, store } = setup();
    svc.payCustomsDuty('phone', true);
    store.resetDemo();
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(false);
  });
});
