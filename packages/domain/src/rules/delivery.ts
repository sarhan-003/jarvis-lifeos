// Delivery rules: rescheduling and delivery instructions.
import type { Customer, DeliverySlot, InstructionType, Shipment, TrackingEvent } from '../schemas.js';
import { WINDOW_LABELS } from '../schemas.js';
import { addDays, isoDate } from '../dates.js';
import { fail, ok, type RuleResult } from './result.js';

const event = (now: Date, code: string, description: string): TrackingEvent => ({
  timestamp: now.toISOString(),
  location: 'Seattle, WA',
  code,
  description,
});

export function canReschedule(shipment: Shipment): RuleResult<true> {
  switch (shipment.status) {
    case 'Delivered':
      return fail(`Your ${shipment.nickname} has already been delivered.`);
    case 'LabelCreated':
      return fail(`Your ${shipment.nickname} hasn't shipped yet, so it can't be rescheduled.`);
    case 'CustomsHold':
      return fail(`Your ${shipment.nickname} is held in customs. It needs to be released before delivery can be rescheduled.`);
    case 'ReturnRequested':
      return fail(`Your ${shipment.nickname} is being returned.`);
    default:
      return ok(true);
  }
}

export function applyReschedule(shipment: Shipment, slot: DeliverySlot | undefined, now: Date): RuleResult<Shipment> {
  const allowed = canReschedule(shipment);
  if (!allowed.ok) return allowed;
  if (!slot) return fail('That date is outside the delivery slots I can offer. Ask me for the available slots.');
  if (!slot.available) return fail(`The ${slot.window} slot on that day is full. Ask me for other available slots.`);
  if (slot.date <= isoDate(now)) return fail('Deliveries can only be moved to a future day.');
  return ok({
    ...shipment,
    status: shipment.status === 'OutForDelivery' || shipment.status === 'DeliveryException' ? 'InTransit' : shipment.status,
    eta: slot.date,
    deliveryWindow: slot.window,
    events: [...shipment.events, event(now, 'RESCHEDULED', `Delivery rescheduled to ${slot.date}, ${slot.window} (${WINDOW_LABELS[slot.window]})`)],
  });
}

export function applyInstruction(
  shipment: Shipment,
  customer: Customer,
  type: InstructionType,
  details: string | undefined,
  now: Date,
): RuleResult<Shipment> {
  if (shipment.status === 'Delivered' || shipment.status === 'ReturnRequested') {
    return fail(`Your ${shipment.nickname} has already been delivered, so delivery instructions can't change.`);
  }
  const d = details?.trim();
  let instruction: string;
  switch (type) {
    case 'front_door':
      instruction = 'Leave at the front door';
      break;
    case 'back_door':
      instruction = 'Leave at the back door';
      break;
    case 'reception':
      instruction = 'Leave with building reception';
      break;
    case 'gate_code':
      if (!d) return fail('What is the gate code?');
      instruction = `Use gate code ${d}`;
      break;
    case 'neighbour': {
      const named = d ? customer.neighbours.find((n) => d.toLowerCase().includes(n.name.toLowerCase())) : undefined;
      const neighbour = named ?? customer.neighbours[0];
      if (!neighbour) return fail('I don\'t have a neighbour on file. Who should we leave it with?');
      instruction = `Leave with ${neighbour.name} in ${neighbour.unit}`;
      break;
    }
    case 'address_correction': {
      const unit = d ? (/\b(?:unit|apt|apartment|suite|#)?\s*([0-9]+[a-z]?)\b/i.exec(d)?.[1] ?? null) : null;
      if (!unit) return fail('What is the unit or apartment number?');
      const [street, ...rest] = shipment.destination.split(',');
      const destination = [`${street?.trim()}, Unit ${unit.toUpperCase()}`, ...rest.map((r) => r.trim())].join(', ');
      const wasException = shipment.status === 'DeliveryException';
      return ok({
        ...shipment,
        destination,
        status: wasException ? 'InTransit' : shipment.status,
        exceptionReason: undefined,
        eta: wasException ? addDays(isoDate(now), 1) : shipment.eta,
        deliveryWindow: wasException ? 'afternoon' : shipment.deliveryWindow,
        deliveryInstructions: shipment.deliveryInstructions,
        events: [
          ...shipment.events,
          event(now, 'ADDRESS_CORRECTED', `Address corrected to unit ${unit.toUpperCase()}${wasException ? '; redelivery scheduled' : ''}`),
        ],
      });
    }
  }
  return ok({
    ...shipment,
    deliveryInstructions: instruction,
    events: [...shipment.events, event(now, 'INSTRUCTIONS', `Delivery instructions updated: ${instruction}`)],
  });
}
