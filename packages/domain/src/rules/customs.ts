// Customs rules: duty arithmetic, simulated payment, document receipt and release.
import type { DocumentType, Shipment, TrackingEvent } from '../schemas.js';
import { addDays, isoDate } from '../dates.js';
import { roundMoney } from '../speech.js';
import { fail, ok, type RuleResult } from './result.js';

export interface DutyBreakdown {
  declaredValueUsd: number;
  ratePercent: number;
  duty: number;
  fee: number;
  total: number;
}

export function calculateDuty(declaredValueUsd: number, ratePercent: number, feeUsd: number): DutyBreakdown {
  const duty = roundMoney((declaredValueUsd * ratePercent) / 100);
  return { declaredValueUsd, ratePercent, duty, fee: roundMoney(feeUsd), total: roundMoney(duty + feeUsd) };
}

export function dutyFor(shipment: Shipment): DutyBreakdown | null {
  const c = shipment.customs;
  if (!c) return null;
  return calculateDuty(shipment.declaredValueUsd, c.dutyRatePercent, c.processingFeeUsd);
}

const event = (now: Date, code: string, description: string): TrackingEvent => ({
  timestamp: now.toISOString(),
  location: 'Seattle, WA',
  code,
  description,
});

/** Release from customs when nothing is blocking: ETA becomes tomorrow. */
export function releaseIfClear(shipment: Shipment, now: Date): Shipment {
  const c = shipment.customs;
  if (!c || shipment.status !== 'CustomsHold') return shipment;
  if (c.holdReasonCodes.length || c.missingDocuments.length) return shipment;
  return {
    ...shipment,
    status: 'ArrivedInCountry',
    eta: addDays(isoDate(now), 1),
    deliveryWindow: 'afternoon',
    events: [...shipment.events, event(now, 'CUSTOMS_RELEASED', 'Released by customs; scheduled for delivery')],
  };
}

export function applyPayment(shipment: Shipment, now: Date, paymentReference: string): RuleResult<Shipment> {
  const c = shipment.customs;
  if (!c || shipment.status !== 'CustomsHold') return fail(`Your ${shipment.nickname} isn't held in customs, so there's nothing to pay.`);
  if (c.isPaid) return fail(`The duty for your ${shipment.nickname} is already paid (reference ${c.paymentReference}).`);
  const duty = dutyFor(shipment);
  const paid: Shipment = {
    ...shipment,
    customs: {
      ...c,
      isPaid: true,
      paymentReference,
      holdReasonCodes: c.holdReasonCodes.filter((r) => r !== 'DUTY_UNPAID'),
    },
    events: [...shipment.events, event(now, 'DUTY_PAID', `Import duty of $${duty?.total.toFixed(2)} paid (ref ${paymentReference})`)],
  };
  return ok(releaseIfClear(paid, now));
}

export function applyDocument(shipment: Shipment, documentType: DocumentType, now: Date): RuleResult<Shipment> {
  const c = shipment.customs;
  if (!c || shipment.status !== 'CustomsHold') return fail(`Your ${shipment.nickname} isn't held in customs, so no documents are needed.`);
  if (!c.missingDocuments.includes(documentType)) {
    return fail(`Customs isn't waiting for a ${documentType === 'commercial_invoice' ? 'commercial invoice' : 'proof of ID'} for your ${shipment.nickname}.`);
  }
  const clears = documentType === 'commercial_invoice' ? 'DOC_MISSING_INVOICE' : 'ID_VERIFICATION';
  const label = documentType === 'commercial_invoice' ? 'Commercial invoice' : 'Proof of ID';
  const updated: Shipment = {
    ...shipment,
    customs: {
      ...c,
      missingDocuments: c.missingDocuments.filter((d) => d !== documentType),
      holdReasonCodes: c.holdReasonCodes.filter((r) => r !== clears),
    },
    events: [...shipment.events, event(now, 'DOC_RECEIVED', `${label} received by customs`)],
  };
  return ok(releaseIfClear(updated, now));
}
