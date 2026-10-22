// Map MCP tool results (structuredContent) from one turn to UI cards.
import type { Card, ConfirmationData, CustomsView, PaymentView, ShipmentSummary, TrackingView } from '@parcel/domain';
import { formatUsd, WINDOW_LABELS, type DeliveryWindow } from '@parcel/domain';

export interface TurnToolResult {
  name: string;
  args: Record<string, unknown>;
  structured: Record<string, unknown> | null;
  text: string;
  isError: boolean;
}

// structuredContent is the domain view object plus { ok, speech }; these casts
// narrow it to the view each tool is documented to return.
const as = <T>(v: Record<string, unknown>): T => v as unknown as T;

export function cardFor(r: TurnToolResult): Card | null {
  const s = r.structured;
  if (r.isError || !s || s.ok === false) {
    const candidates = Array.isArray(s?.candidates) ? (s.candidates as string[]) : undefined;
    return { type: 'error', data: { message: r.text || String(s?.error ?? 'Something went wrong.'), ...(candidates ? { candidates } : {}) } };
  }
  switch (r.name) {
    case 'list_active_shipments':
      return { type: 'shipment_list', data: as<{ shipments: ShipmentSummary[]; count: number }>(s) };
    case 'track_shipment':
      return { type: 'timeline', data: as<TrackingView>(s) };
    case 'get_customs_status':
      return { type: 'customs', data: as<CustomsView>(s) };
    case 'get_delivery_slots':
      return { type: 'slots', data: as<Extract<Card, { type: 'slots' }>['data']>(s) };
    case 'get_proof_of_delivery':
      return { type: 'pod', data: as<Extract<Card, { type: 'pod' }>['data']>(s) };
    case 'request_return_pickup':
      return { type: 'return', data: as<Extract<Card, { type: 'return' }>['data']>(s) };
    case 'pay_customs_duty': {
      const p = as<PaymentView>(s);
      const lines = [
        `Import duty (${p.duty.ratePercent}% of ${formatUsd(p.duty.declaredValueUsd)}): ${formatUsd(p.duty.duty)}`,
        `Processing fee: ${formatUsd(p.duty.fee)}`,
        `Total: ${formatUsd(p.duty.total)}`,
      ];
      const data: ConfirmationData = p.confirmed
        ? {
            kind: 'payment_done',
            title: `Duty paid for your ${p.nickname}`,
            lines: [...lines, `Reference ${p.paymentReference ?? ''}`, ...(p.remainingBlockers.length ? [`Still needed: ${p.remainingBlockers.join(', ')}`] : ['Released from customs'])],
            nickname: p.nickname,
            amountUsd: p.amountUsd,
            reference: p.paymentReference,
            needsAnswer: false,
          }
        : { kind: 'payment_quote', title: `Pay ${formatUsd(p.amountUsd)} duty for your ${p.nickname}?`, lines: [...lines, 'Payment method on file'], nickname: p.nickname, amountUsd: p.amountUsd, needsAnswer: true };
      return { type: 'confirmation', data };
    }
    case 'upload_customs_document': {
      const d = as<{ nickname: string; documentType: string; status: string; missingDocuments: string[]; dutyPaid: boolean }>(s);
      return {
        type: 'confirmation',
        data: {
          kind: 'document',
          title: `${d.documentType === 'commercial_invoice' ? 'Commercial invoice' : 'Proof of ID'} received`,
          lines: [`Parcel: ${d.nickname}`, 'Upload link sent to your phone (simulated)', d.status === 'CustomsHold' ? (d.dutyPaid ? 'Customs is reviewing' : 'Duty still unpaid') : 'Released from customs'],
          nickname: d.nickname,
          needsAnswer: false,
        },
      };
    }
    case 'reschedule_delivery': {
      const d = as<{ nickname: string; eta: string; deliveryWindow: DeliveryWindow }>(s);
      return {
        type: 'confirmation',
        data: { kind: 'reschedule', title: `Delivery rescheduled`, lines: [`Parcel: ${d.nickname}`, `New date: ${d.eta}`, `Window: ${d.deliveryWindow} (${WINDOW_LABELS[d.deliveryWindow]})`], nickname: d.nickname, needsAnswer: false },
      };
    }
    case 'update_delivery_instructions': {
      const d = as<{ nickname: string; instructionType: string; deliveryInstructions: string | null; destination: string; status: string; eta: string | null }>(s);
      const lines =
        d.instructionType === 'address_correction'
          ? [`New address: ${d.destination}`, `Status: ${d.status === 'InTransit' ? 'Back on the way' : d.status}`, ...(d.eta ? [`New ETA: ${d.eta}`] : [])]
          : [`Instruction: ${d.deliveryInstructions ?? ''}`];
      return { type: 'confirmation', data: { kind: 'instructions', title: `Delivery updated for your ${d.nickname}`, lines, nickname: d.nickname, needsAnswer: false } };
    }
    default:
      return null;
  }
}

export function cardsForTurn(results: TurnToolResult[]): Card[] {
  const rescheduled = results.some((r) => r.name === 'reschedule_delivery' && !r.isError);
  return results
    .filter((r) => !(rescheduled && r.name === 'get_delivery_slots'))
    .map(cardFor)
    .filter((c): c is Card => c !== null);
}
