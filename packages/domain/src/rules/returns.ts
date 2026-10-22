// Return rules: only delivered parcels inside the return window.
import type { DeliveryWindow, ReturnRequest, Shipment } from '../schemas.js';
import { isoDate } from '../dates.js';
import { fail, ok, type RuleResult } from './result.js';

export function canReturn(shipment: Shipment, now: Date): RuleResult<true> {
  if (shipment.status === 'ReturnRequested') return fail(`A return is already booked for your ${shipment.nickname}.`);
  if (shipment.status !== 'Delivered') return fail(`Your ${shipment.nickname} hasn't been delivered yet, so it can't be returned.`);
  if (!shipment.returnEligibleUntil || isoDate(now) > shipment.returnEligibleUntil) {
    return fail(`The return window for your ${shipment.nickname} has closed.`);
  }
  return ok(true);
}

export function applyReturn(
  shipment: Shipment,
  request: { id: string; reason: string; pickupDate: string; pickupWindow: DeliveryWindow },
  now: Date,
): RuleResult<{ shipment: Shipment; request: ReturnRequest }> {
  const allowed = canReturn(shipment, now);
  if (!allowed.ok) return allowed;
  if (request.pickupDate <= isoDate(now)) return fail('Pickups can be booked from tomorrow onwards.');
  if (shipment.returnEligibleUntil && request.pickupDate > shipment.returnEligibleUntil) {
    return fail(`The pickup must be on or before ${shipment.returnEligibleUntil}, when the return window closes.`);
  }
  return ok({
    request: { ...request, shipmentId: shipment.id },
    shipment: {
      ...shipment,
      status: 'ReturnRequested',
      events: [
        ...shipment.events,
        {
          timestamp: now.toISOString(),
          location: 'Seattle, WA',
          code: 'RETURN_REQUESTED',
          description: `Return pickup booked for ${request.pickupDate}, ${request.pickupWindow} (${request.id})`,
        },
      ],
    },
  });
}
