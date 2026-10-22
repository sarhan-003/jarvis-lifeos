// Shapes shared by the agent API and the React app (type-only for the web).
import type { DeliverySlot, ReturnRequest } from './schemas.js';
import type { CustomsView, PaymentView, ShipmentSummary, TrackingView } from './service.js';

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  durationMs: number;
  isError: boolean;
  /** The tool's spoken text, handy in the trace panel. */
  text: string;
}

export interface ConfirmationData {
  kind: 'payment_quote' | 'payment_done' | 'document' | 'reschedule' | 'instructions';
  title: string;
  lines: string[];
  nickname: string;
  amountUsd?: number;
  reference?: string | null;
  /** True when the assistant is waiting for a yes/no. */
  needsAnswer: boolean;
}

export type Card =
  | { type: 'shipment_list'; data: { shipments: ShipmentSummary[]; count: number } }
  | { type: 'timeline'; data: TrackingView }
  | { type: 'customs'; data: CustomsView }
  | { type: 'slots'; data: { nickname: string; currentEta: string | null; slots: DeliverySlot[] } }
  | { type: 'confirmation'; data: ConfirmationData }
  | { type: 'return'; data: ReturnRequest & { nickname: string; windowLabel: string; labelDelivery: string } }
  | { type: 'pod'; data: { nickname: string; deliveredAt: string; leftAt: string; photoRef: string; signedBy: string | null; returnEligibleUntil: string | null } }
  | { type: 'error'; data: { message: string; candidates?: string[] } };

export type CardType = Card['type'];

export interface ChatResponse {
  speech: string;
  cards: Card[];
  toolCalls: ToolCallTrace[];
  engine: string;
  notice?: string;
}

export interface HealthResponse {
  ok: boolean;
  engine: string;
  engineWarning?: string;
  mcp: { url: string; reachable: boolean; tools: number; error?: string };
}

export type { PaymentView };
