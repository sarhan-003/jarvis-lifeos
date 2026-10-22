// Parcel Concierge operations, one per MCP tool. Each returns a short,
// speakable sentence (for voice) and structured data (for UI cards).
import type { DeliverySlot, DeliveryWindow, DocumentType, InstructionType, ReturnRequest, Shipment, ShipmentStatus, TrackingEvent } from './schemas.js';
import { HOLD_REASON_TEXT, WINDOW_LABELS } from './schemas.js';
import type { ShipmentStore } from './store.js';
import { isoDate, resolveDate, spokenDay, spokenTime } from './dates.js';
import { formatUsd, listJoin, numberToWords, spokenUsd } from './speech.js';
import { resolveShipment } from './rules/resolve.js';
import { applyDocument, applyPayment, dutyFor, type DutyBreakdown } from './rules/customs.js';
import { applyInstruction, applyReschedule, canReschedule } from './rules/delivery.js';
import { applyReturn } from './rules/returns.js';

export type OpResult<T> =
  | { ok: true; speech: string; data: T }
  | { ok: false; speech: string; data: { error: string; candidates?: string[] } };

const success = <T>(speech: string, data: T): OpResult<T> => ({ ok: true, speech, data });
const failure = <T>(error: string, candidates?: string[]): OpResult<T> => ({
  ok: false,
  speech: error,
  data: candidates ? { error, candidates } : { error },
});

export const STATUS_TEXT: Record<ShipmentStatus, string> = {
  LabelCreated: 'Label created, not shipped yet',
  InTransit: 'In transit',
  ArrivedInCountry: 'Cleared customs',
  CustomsHold: 'Held in customs',
  OutForDelivery: 'Out for delivery',
  Delivered: 'Delivered',
  DeliveryException: 'Delivery problem',
  ReturnRequested: 'Return requested',
};

export interface ShipmentSummary {
  id: string;
  nickname: string;
  trackingNumber: string;
  itemDescription: string;
  status: ShipmentStatus;
  statusText: string;
  eta: string | null;
  deliveryWindow: DeliveryWindow | null;
  needsAction: string | null;
}

export interface TrackingView extends ShipmentSummary {
  merchant: string;
  origin: string;
  destination: string;
  deliveryInstructions: string | null;
  recentEvents: TrackingEvent[];
}

export interface CustomsView {
  nickname: string;
  trackingNumber: string;
  inCustoms: boolean;
  status: ShipmentStatus;
  holdReasons: { code: string; text: string }[];
  missingDocuments: DocumentType[];
  hsCode: string | null;
  duty: DutyBreakdown | null;
  isPaid: boolean;
  paymentReference: string | null;
  nextStep: string;
}

export interface PaymentView {
  nickname: string;
  trackingNumber: string;
  confirmed: boolean;
  amountUsd: number;
  duty: DutyBreakdown;
  paymentReference: string | null;
  status: ShipmentStatus;
  eta: string | null;
  remainingBlockers: string[];
}

function summarize(s: Shipment): ShipmentSummary {
  const needsAction =
    s.status === 'CustomsHold'
      ? 'Customs needs action'
      : s.status === 'DeliveryException'
        ? (s.exceptionReason ?? 'Delivery problem')
        : null;
  return {
    id: s.id,
    nickname: s.nickname,
    trackingNumber: s.trackingNumber,
    itemDescription: s.itemDescription,
    status: s.status,
    statusText: STATUS_TEXT[s.status],
    eta: s.eta ?? null,
    deliveryWindow: s.deliveryWindow ?? null,
    needsAction,
  };
}

export interface ServiceOptions {
  /** Reference generator, injectable for tests. */
  newReference?: (kind: 'PAY' | 'RET') => string;
}

const randomDigits = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

export class ParcelConcierge {
  private readonly newReference: (kind: 'PAY' | 'RET') => string;

  constructor(
    private readonly store: ShipmentStore,
    options: ServiceOptions = {},
  ) {
    this.newReference = options.newReference ?? ((kind) => `SLX-${kind}-${randomDigits(kind === 'PAY' ? 6 : 5)}`);
  }

  private today(): string {
    return isoDate(this.store.now());
  }

  private when(s: Pick<Shipment, 'eta' | 'deliveryWindow'>): string {
    if (!s.eta) return '';
    const day = spokenDay(s.eta, this.today());
    const window = s.deliveryWindow ? (day === 'today' ? `this ${s.deliveryWindow}` : `${day} ${s.deliveryWindow}`) : day;
    return s.deliveryWindow && day === 'today' ? window : s.deliveryWindow ? window : day;
  }

  private find(query: string): OpResult<Shipment> {
    const r = resolveShipment(this.store.listShipments(), query);
    return r.ok ? success('', r.value) : failure(r.error, r.candidates);
  }

  listActiveShipments({ includeDelivered = false } = {}): OpResult<{ shipments: ShipmentSummary[]; count: number }> {
    const all = this.store.listShipments().filter((s) => includeDelivered || (s.status !== 'Delivered' && s.status !== 'ReturnRequested'));
    const sorted = all.sort((a, b) => (a.eta ?? '9999').localeCompare(b.eta ?? '9999'));
    const shipments = sorted.map(summarize);
    if (!shipments.length) return success('You have no parcels on the way right now.', { shipments, count: 0 });

    const arriving = sorted.filter((s) => s.eta && ['OutForDelivery', 'InTransit', 'ArrivedInCountry'].includes(s.status));
    const parts = arriving.slice(0, 3).map((s, i) => `${i === 0 ? 'Your' : 'your'} ${s.nickname} ${s.status === 'OutForDelivery' ? 'arrives' : 'should arrive'} ${this.when(s)}`);
    const issues = sorted
      .filter((s) => s.status === 'CustomsHold' || s.status === 'DeliveryException')
      .map((s) => (s.status === 'CustomsHold' ? `your ${s.nickname} is held in customs` : `your ${s.nickname} had a delivery problem`));
    const n = shipments.length;
    let speech = `You have ${numberToWords(n)} parcel${n === 1 ? '' : 's'} ${includeDelivered ? 'in total' : 'on the way'}.`;
    if (parts.length) speech += ` ${listJoin(parts)}.`;
    if (issues.length) speech += ` Heads up: ${listJoin(issues)}.`;
    return success(speech, { shipments, count: n });
  }

  trackShipment(query: string): OpResult<TrackingView> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const view: TrackingView = {
      ...summarize(s),
      merchant: s.merchant,
      origin: s.origin,
      destination: s.destination,
      deliveryInstructions: s.deliveryInstructions ?? null,
      recentEvents: s.events.slice(-5).reverse(),
    };
    const last = s.events.at(-1);
    let speech: string;
    switch (s.status) {
      case 'Delivered':
        speech = `Your ${s.nickname} was delivered ${s.proofOfDelivery ? `${spokenDay(isoDate(new Date(s.proofOfDelivery.deliveredAt)), this.today())} at ${spokenTime(s.proofOfDelivery.deliveredAt)}, left at the ${s.proofOfDelivery.leftAt}` : ''}.`;
        break;
      case 'CustomsHold':
        speech = `Your ${s.nickname} is held in customs in Seattle. Ask me why and I can help clear it.`;
        break;
      case 'DeliveryException':
        speech = `Delivery of your ${s.nickname} failed: ${(s.exceptionReason ?? 'there was a problem').toLowerCase()}. I can fix the address for you.`;
        break;
      case 'LabelCreated':
        speech = `Your ${s.nickname} hasn't shipped yet; the merchant has created the label.`;
        break;
      default:
        speech = `Your ${s.nickname} is ${STATUS_TEXT[s.status].toLowerCase()}${s.eta ? ` and should arrive ${this.when(s)}` : ''}.`;
    }
    if (s.deliveryInstructions && s.status !== 'Delivered') speech += ` Instructions: ${s.deliveryInstructions.toLowerCase()}.`;
    if (!speech.trim() && last) speech = last.description;
    return success(speech.replace(/\s+\./g, '.'), view);
  }

  getCustomsStatus(query: string): OpResult<CustomsView> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const c = s.customs;
    const inCustoms = s.status === 'CustomsHold';
    const duty = dutyFor(s);
    const missing = c?.missingDocuments ?? [];
    const unpaid = Boolean(c && !c.isPaid && c.holdReasonCodes.includes('DUTY_UNPAID'));
    const steps: string[] = [];
    if (missing.includes('commercial_invoice')) steps.push('send the commercial invoice');
    if (missing.includes('id_proof')) steps.push('verify your ID');
    if (unpaid && duty) steps.push(`pay the duty of ${spokenUsd(duty.total)}`);
    const nextStep = inCustoms ? (steps.length ? `You need to ${listJoin(steps)}.` : 'Nothing; it should be released shortly.') : 'No customs action needed.';
    const view: CustomsView = {
      nickname: s.nickname,
      trackingNumber: s.trackingNumber,
      inCustoms,
      status: s.status,
      holdReasons: (c?.holdReasonCodes ?? []).map((code) => ({ code, text: HOLD_REASON_TEXT[code] })),
      missingDocuments: missing,
      hsCode: c?.hsCode ?? null,
      duty,
      isPaid: c?.isPaid ?? false,
      paymentReference: c?.paymentReference ?? null,
      nextStep,
    };
    if (!inCustoms) {
      return success(c ? `Your ${s.nickname} has cleared customs.` : `Your ${s.nickname} isn't going through customs.`, view);
    }
    const reasons = view.holdReasons.map((r) => r.text.replace(/\.$/, '').replace(/^Customs needs/, 'they need').replace(/^Import duty/, 'import duty'));
    return success(`Your ${s.nickname} is held because ${listJoin(reasons)}. ${nextStep}`, view);
  }

  payCustomsDuty(query: string, confirm: boolean): OpResult<PaymentView> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const duty = dutyFor(s);
    if (!s.customs || !duty || s.status !== 'CustomsHold') return failure(`Your ${s.nickname} isn't held in customs, so there's nothing to pay.`);
    if (s.customs.isPaid) return failure(`The duty for your ${s.nickname} is already paid, reference ${s.customs.paymentReference}.`);

    const base = { nickname: s.nickname, trackingNumber: s.trackingNumber, amountUsd: duty.total, duty };
    if (!confirm) {
      return success(
        `The duty for your ${s.nickname} is ${spokenUsd(duty.total, 'exact')}: ${spokenUsd(duty.duty, 'exact')} import duty plus a ${spokenUsd(duty.fee, 'exact')} processing fee. I'll use the payment method on file. Should I pay it?`,
        { ...base, confirmed: false, paymentReference: null, status: s.status, eta: s.eta ?? null, remainingBlockers: [] },
      );
    }
    const ref = this.newReference('PAY');
    const r = applyPayment(s, this.store.now(), ref);
    if (!r.ok) return failure(r.error);
    this.store.saveShipment(r.value);
    const blockers = r.value.customs?.missingDocuments ?? [];
    const remainingBlockers = blockers.map((d) => (d === 'commercial_invoice' ? 'commercial invoice' : 'proof of ID'));
    const after = remainingBlockers.length
      ? `Customs still needs the ${listJoin(remainingBlockers)} before it can be released.`
      : `It's released from customs and should arrive ${this.when(r.value)}.`;
    return success(`Done. I paid ${spokenUsd(duty.total, 'exact')} for your ${s.nickname}. ${after}`, {
      ...base,
      confirmed: true,
      paymentReference: ref,
      status: r.value.status,
      eta: r.value.eta ?? null,
      remainingBlockers,
    });
  }

  uploadCustomsDocument(query: string, documentType: DocumentType): OpResult<{ nickname: string; documentType: DocumentType; status: ShipmentStatus; eta: string | null; missingDocuments: DocumentType[]; dutyPaid: boolean }> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const r = applyDocument(s, documentType, this.store.now());
    if (!r.ok) return failure(r.error);
    this.store.saveShipment(r.value);
    const label = documentType === 'commercial_invoice' ? 'commercial invoice' : 'proof of ID';
    const released = r.value.status !== 'CustomsHold';
    const unpaid = !r.value.customs?.isPaid;
    const after = released
      ? `That was the last blocker, so it's released and should arrive ${this.when(r.value)}.`
      : unpaid
        ? 'The duty still needs to be paid.'
        : 'Customs is reviewing it.';
    return success(`Got it. I've marked the ${label} for your ${s.nickname} as received by customs. ${after}`, {
      nickname: s.nickname,
      documentType,
      status: r.value.status,
      eta: r.value.eta ?? null,
      missingDocuments: r.value.customs?.missingDocuments ?? [],
      dutyPaid: !unpaid,
    });
  }

  getDeliverySlots(query: string, fromDate?: string): OpResult<{ nickname: string; currentEta: string | null; slots: DeliverySlot[] }> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const allowed = canReschedule(s);
    if (!allowed.ok) return failure(allowed.error);
    const from = fromDate ? resolveDate(fromDate, this.today()) : null;
    if (fromDate && !from) return failure(`I didn't understand the date "${fromDate}".`);
    const slots = this.store
      .listSlots()
      .filter((slot) => slot.available && (!from || slot.date >= from))
      .slice(0, 9);
    if (!slots.length) return failure('There are no free delivery slots in the next week.');
    const firstThree = slots.slice(0, 3).map((slot) => `${spokenDay(slot.date, this.today())} ${slot.window}`);
    return success(`For your ${s.nickname}, the next free slots are ${listJoin(firstThree)}. Which one works?`, {
      nickname: s.nickname,
      currentEta: s.eta ?? null,
      slots,
    });
  }

  rescheduleDelivery(query: string, date: string, window: DeliveryWindow): OpResult<{ nickname: string; eta: string; deliveryWindow: DeliveryWindow; windowLabel: string; status: ShipmentStatus }> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const resolved = resolveDate(date, this.today());
    if (!resolved) return failure(`I didn't understand the date "${date}".`);
    const r = applyReschedule(s, this.store.findSlot(resolved, window), this.store.now());
    if (!r.ok) return failure(r.error);
    this.store.saveShipment(r.value);
    return success(`Done. Your ${s.nickname} will now arrive ${spokenDay(resolved, this.today())} ${window}, between ${WINDOW_LABELS[window]}.`, {
      nickname: s.nickname,
      eta: resolved,
      deliveryWindow: window,
      windowLabel: WINDOW_LABELS[window],
      status: r.value.status,
    });
  }

  updateDeliveryInstructions(query: string, type: InstructionType, details?: string): OpResult<{ nickname: string; instructionType: InstructionType; deliveryInstructions: string | null; destination: string; status: ShipmentStatus; eta: string | null }> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const r = applyInstruction(s, this.store.customer, type, details, this.store.now());
    if (!r.ok) return failure(r.error);
    this.store.saveShipment(r.value);
    const data = {
      nickname: s.nickname,
      instructionType: type,
      deliveryInstructions: r.value.deliveryInstructions ?? null,
      destination: r.value.destination,
      status: r.value.status,
      eta: r.value.eta ?? null,
    };
    if (type === 'address_correction') {
      const fixed = s.status === 'DeliveryException';
      return success(
        `Thanks, I've updated the address to ${r.value.destination.split(',')[1]?.trim() ?? 'the new unit'}.${fixed ? ` Your ${s.nickname} is back on the way and should arrive ${this.when(r.value)}.` : ''}`,
        data,
      );
    }
    return success(`Okay. For your ${s.nickname}, the driver will ${r.value.deliveryInstructions?.charAt(0).toLowerCase()}${r.value.deliveryInstructions?.slice(1)}.`, data);
  }

  getProofOfDelivery(query: string): OpResult<{ nickname: string; deliveredAt: string; leftAt: string; photoRef: string; signedBy: string | null; returnEligibleUntil: string | null }> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const pod = s.proofOfDelivery;
    if (!pod) return failure(`Your ${s.nickname} hasn't been delivered yet, so there's no proof of delivery.`);
    const day = spokenDay(isoDate(new Date(pod.deliveredAt)), this.today());
    const returnable = s.status === 'Delivered' && s.returnEligibleUntil && this.today() <= s.returnEligibleUntil;
    return success(
      `Yes. Your ${s.nickname} was delivered ${day} at ${spokenTime(pod.deliveredAt)} and left at the ${pod.leftAt}. There's a delivery photo on file.${returnable ? ` You can return it until ${spokenDay(s.returnEligibleUntil as string, this.today())}.` : ''}`,
      {
        nickname: s.nickname,
        deliveredAt: pod.deliveredAt,
        leftAt: pod.leftAt,
        photoRef: pod.photoRef,
        signedBy: pod.signedBy ?? null,
        returnEligibleUntil: s.returnEligibleUntil ?? null,
      },
    );
  }

  requestReturnPickup(query: string, reason: string, pickupDate: string, pickupWindow: DeliveryWindow): OpResult<ReturnRequest & { nickname: string; windowLabel: string; labelDelivery: string }> {
    const found = this.find(query);
    if (!found.ok) return found;
    const s = found.data;
    const date = resolveDate(pickupDate, this.today());
    if (!date) return failure(`I didn't understand the pickup date "${pickupDate}".`);
    const id = this.newReference('RET');
    const r = applyReturn(s, { id, reason, pickupDate: date, pickupWindow }, this.store.now());
    if (!r.ok) return failure(r.error);
    this.store.saveShipment(r.value.shipment);
    this.store.addReturn(r.value.request);
    return success(
      `Your return is booked. A courier will pick up your ${s.nickname} ${spokenDay(date, this.today())} ${pickupWindow}, and I've sent the QR code to your email.`,
      { ...r.value.request, nickname: s.nickname, windowLabel: WINDOW_LABELS[pickupWindow], labelDelivery: 'QR code sent to your email (simulated)' },
    );
  }
}

export { formatUsd };
