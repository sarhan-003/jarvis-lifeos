// Fictional demo data for SwiftLane Express. Every date is computed relative
// to `now`, so the demo story works on any day.
import type { Customer, DeliverySlot, DeliveryWindow, Shipment, TrackingEvent } from './schemas.js';
import { addDays, isoDate, weekday } from './dates.js';
import { calculateDuty } from './rules/customs.js';

export const DEMO_CUSTOMER_ID = 'cust_alex';

export const DEMO_CUSTOMER: Customer = {
  id: DEMO_CUSTOMER_ID,
  name: 'Alex Rivera',
  defaultAddress: '2150 Lantern Lane, Seattle, WA 98101',
  neighbours: [{ name: 'Sam', unit: '4B' }],
};

/** Deterministic PRNG (mulberry32) so slot availability is the same every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (now: Date, dayOffset: number, hour: number, minute = 0): string => {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const ev = (timestamp: string, location: string, code: string, description: string): TrackingEvent => ({ timestamp, location, code, description });

export const SLOT_DAYS = 7;
export const SLOT_WINDOWS: DeliveryWindow[] = ['morning', 'afternoon', 'evening'];

/**
 * Delivery slots for the next SLOT_DAYS days (from tomorrow), ~30% unavailable
 * using a seeded PRNG. The next Saturday evening is always kept available so
 * the scripted demo line "can the books come Saturday evening?" works.
 */
export function createSlots(now: Date, seed = 20261023): DeliverySlot[] {
  const rand = mulberry32(seed);
  const today = isoDate(now);
  const slots: DeliverySlot[] = [];
  for (let day = 1; day <= SLOT_DAYS; day += 1) {
    const date = addDays(today, day);
    for (const window of SLOT_WINDOWS) {
      const keep = weekday(date) === 'Saturday' && window === 'evening';
      slots.push({ date, window, available: keep || rand() >= 0.3 });
    }
  }
  return slots;
}

export function createSeedShipments(now: Date): Shipment[] {
  const today = isoDate(now);
  const phoneDuty = calculateDuty(899, 2.5, 12);
  const deliveredAt = at(now, -1, 14, 32);

  return [
    {
      id: 'shp_phone',
      trackingNumber: 'SLX4820193756',
      customerId: DEMO_CUSTOMER_ID,
      nickname: 'phone',
      itemDescription: 'Nova X2 smartphone, 256 GB',
      merchant: 'Lumen Mobile Store',
      declaredValueUsd: 899,
      origin: 'Shenzhen, China',
      destination: DEMO_CUSTOMER.defaultAddress,
      status: 'CustomsHold',
      events: [
        ev(at(now, -6, 9, 10), 'Shenzhen, China', 'LABEL', 'Shipping label created'),
        ev(at(now, -5, 18, 40), 'Shenzhen, China', 'DEPART', 'Departed origin facility'),
        ev(at(now, -4, 7, 5), 'Hong Kong', 'TRANSIT', 'In transit to destination country'),
        ev(at(now, -2, 6, 20), 'Seattle, WA', 'ARRIVE', 'Arrived in destination country'),
        ev(at(now, -2, 11, 45), 'Seattle, WA', 'CUSTOMS_HOLD', 'Held by customs: commercial invoice missing, import duty unpaid'),
      ],
      customs: {
        holdReasonCodes: ['DOC_MISSING_INVOICE', 'DUTY_UNPAID'],
        missingDocuments: ['commercial_invoice'],
        hsCode: '8517.13.00',
        dutyRatePercent: 2.5,
        dutyAmountUsd: phoneDuty.duty,
        processingFeeUsd: phoneDuty.fee,
        isPaid: false,
      },
    },
    {
      id: 'shp_headphones',
      trackingNumber: 'SLX3391027465',
      customerId: DEMO_CUSTOMER_ID,
      nickname: 'headphones',
      itemDescription: 'Aerial Pro wireless headphones',
      merchant: 'SoundNest',
      declaredValueUsd: 249,
      origin: 'Portland, OR',
      destination: DEMO_CUSTOMER.defaultAddress,
      status: 'Delivered',
      eta: addDays(today, -1),
      deliveryWindow: 'afternoon',
      events: [
        ev(at(now, -4, 10, 0), 'Portland, OR', 'LABEL', 'Shipping label created'),
        ev(at(now, -3, 16, 30), 'Portland, OR', 'DEPART', 'Departed origin facility'),
        ev(at(now, -2, 5, 15), 'Seattle, WA', 'ARRIVE', 'Arrived at local delivery station'),
        ev(at(now, -1, 8, 2), 'Seattle, WA', 'OUT_FOR_DELIVERY', 'Out for delivery'),
        ev(deliveredAt, 'Seattle, WA', 'DELIVERED', 'Delivered, left at front door'),
      ],
      proofOfDelivery: { deliveredAt, leftAt: 'front door', photoRef: 'POD-SLX3391027465.jpg' },
      returnEligibleUntil: addDays(today, 29),
    },
    {
      id: 'shp_shoes',
      trackingNumber: 'SLX5506618230',
      customerId: DEMO_CUSTOMER_ID,
      nickname: 'running shoes',
      itemDescription: 'Stride 9 running shoes, size 10',
      merchant: 'Peak Athletics',
      declaredValueUsd: 140,
      origin: 'Reno, NV',
      destination: DEMO_CUSTOMER.defaultAddress,
      status: 'OutForDelivery',
      eta: today,
      deliveryWindow: 'afternoon',
      events: [
        ev(at(now, -3, 13, 0), 'Reno, NV', 'LABEL', 'Shipping label created'),
        ev(at(now, -2, 19, 10), 'Reno, NV', 'DEPART', 'Departed origin facility'),
        ev(at(now, -1, 22, 40), 'Seattle, WA', 'ARRIVE', 'Arrived at local delivery station'),
        ev(at(now, 0, 7, 55), 'Seattle, WA', 'OUT_FOR_DELIVERY', 'Out for delivery'),
      ],
    },
    {
      id: 'shp_books',
      trackingNumber: 'SLX6627718409',
      customerId: DEMO_CUSTOMER_ID,
      nickname: 'books',
      itemDescription: 'Three paperback books',
      merchant: 'Hollow Oak Books',
      declaredValueUsd: 54,
      origin: 'Chicago, IL',
      destination: DEMO_CUSTOMER.defaultAddress,
      status: 'InTransit',
      eta: addDays(today, 3),
      deliveryWindow: 'morning',
      events: [
        ev(at(now, -2, 11, 20), 'Chicago, IL', 'LABEL', 'Shipping label created'),
        ev(at(now, -1, 17, 5), 'Chicago, IL', 'DEPART', 'Departed origin facility'),
        ev(at(now, 0, 4, 30), 'Denver, CO', 'TRANSIT', 'In transit through regional hub'),
      ],
    },
    {
      id: 'shp_coffee',
      trackingNumber: 'SLX7738829514',
      customerId: DEMO_CUSTOMER_ID,
      nickname: 'coffee machine',
      itemDescription: 'Barista One espresso machine',
      merchant: 'Kettle & Crema',
      declaredValueUsd: 329,
      origin: 'Los Angeles, CA',
      destination: DEMO_CUSTOMER.defaultAddress,
      status: 'DeliveryException',
      exceptionReason: 'Unit number missing from address',
      events: [
        ev(at(now, -4, 9, 0), 'Los Angeles, CA', 'LABEL', 'Shipping label created'),
        ev(at(now, -3, 20, 15), 'Los Angeles, CA', 'DEPART', 'Departed origin facility'),
        ev(at(now, -1, 6, 0), 'Seattle, WA', 'ARRIVE', 'Arrived at local delivery station'),
        ev(at(now, -1, 9, 10), 'Seattle, WA', 'OUT_FOR_DELIVERY', 'Out for delivery'),
        ev(at(now, -1, 15, 47), 'Seattle, WA', 'EXCEPTION', 'Delivery attempted: unit number missing from address'),
      ],
    },
    {
      id: 'shp_stand',
      trackingNumber: 'SLX8849930625',
      customerId: DEMO_CUSTOMER_ID,
      nickname: 'laptop stand',
      itemDescription: 'Aluminium laptop stand',
      merchant: 'DeskCraft',
      declaredValueUsd: 45,
      origin: 'Austin, TX',
      destination: DEMO_CUSTOMER.defaultAddress,
      status: 'LabelCreated',
      eta: addDays(today, 6),
      events: [ev(at(now, 0, 8, 15), 'Austin, TX', 'LABEL', 'Shipping label created; waiting for the merchant to hand over the parcel')],
    },
  ];
}
