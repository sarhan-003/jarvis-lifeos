// Offline engine: a deterministic, rule-based stand-in for the LLM so the
// simulator works without any API key. It plans the same MCP tool calls an LLM
// would for the scripted demo phrases, including multi-step flows (quote then
// pay, slots then reschedule, proof of delivery then return). It understands
// far fewer phrasings than a real model and is labelled as such in the UI.
import type { ToolDef } from '../mcpClient.js';
import type { ChatMessage, LlmProvider, LlmTurn, ToolCall } from './provider.js';

type Awaiting = { type: 'pay'; shipment: string } | { type: 'return_reason'; shipment: string };

interface OfflineState {
  plan?: ToolCall[];
  wantReturn?: string;
  awaiting?: Awaiting;
}

const WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
const DATE_RE = new RegExp(`\\b(\\d{4}-\\d{2}-\\d{2}|tomorrow|today|day after tomorrow|${WEEKDAY})\\b`, 'i');
const WINDOW_RE = /\b(morning|afternoon|evening)\b/i;
const YES_RE = /^(yes|yeah|yep|yup|sure|ok|okay|please do|go ahead|do it|confirm|pay it)\b/i;
const NO_RE = /^(no|nope|cancel|don't|do not|stop|not now)\b/i;

const HELP =
  'I can track parcels, explain customs holds and pay duty, reschedule deliveries, change delivery instructions, and book returns. Try "Where are my packages?"';

let counter = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: `offline_${++counter}`, name, args });

function stateOf(m: ChatMessage | undefined): OfflineState {
  return m?.role === 'assistant' && m.raw?.provider === 'offline' ? (m.raw.content as OfflineState) : {};
}

export class OfflineProvider implements LlmProvider {
  readonly id = 'offline';
  readonly label = 'Offline engine (no LLM key)';

  /** @param nicknames returns the parcel nicknames to recognise in speech */
  constructor(private readonly nicknames: () => Promise<string[]>) {}

  async chat({ messages }: { system: string; messages: ChatMessage[]; tools: ToolDef[] }): Promise<LlmTurn> {
    const last = messages.at(-1);
    // Follow-up round: tool results just came back.
    if (last?.role === 'tool') return this.afterTools(messages);
    if (last?.role !== 'user') return { text: HELP, toolCalls: [] };
    return this.plan(messages, last.text);
  }

  private lastAssistant(messages: ChatMessage[]): Extract<ChatMessage, { role: 'assistant' }> | undefined {
    for (let i = messages.length - 2; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === 'assistant') return m;
    }
    return undefined;
  }

  /** Most recent parcel the conversation was about, for "pay it" / "the duty". */
  private contextShipment(messages: ChatMessage[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m?.role === 'assistant') {
        for (const c of [...m.toolCalls].reverse()) {
          if (typeof c.args.shipment === 'string') return c.args.shipment;
        }
        const s = stateOf(m);
        if (s.awaiting) return s.awaiting.shipment;
      }
    }
    return undefined;
  }

  private async findShipment(text: string): Promise<string | undefined> {
    const t = text.toLowerCase();
    const names = await this.nicknames();
    const exact = names.filter((n) => t.includes(n.toLowerCase()));
    if (exact.length) return exact.sort((a, b) => b.length - a.length)[0];
    const words = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const singular = (w: string) => w.replace(/(es|s)$/, '');
    return names.find((n) => n.toLowerCase().split(' ').some((nw) => words.some((w) => singular(w) === singular(nw))));
  }

  private async plan(messages: ChatMessage[], text: string): Promise<LlmTurn> {
    const t = text.trim().toLowerCase();
    const prev = stateOf(this.lastAssistant(messages));
    const named = await this.findShipment(t);
    const shipment = named ?? this.contextShipment(messages.slice(0, -1));
    const turn = (calls: ToolCall[], state: OfflineState = {}): LlmTurn => {
      const [first, ...rest] = calls;
      return { text: '', toolCalls: first ? [first] : [], raw: { provider: this.id, content: { ...state, plan: rest } } };
    };

    // Answers to a pending question come first.
    if (prev.awaiting?.type === 'pay') {
      if (YES_RE.test(t)) return turn([call('pay_customs_duty', { shipment: prev.awaiting.shipment, confirm: true })]);
      if (NO_RE.test(t)) return { text: "Okay, I won't pay it. Just say the word when you're ready.", toolCalls: [] };
    }
    if (prev.awaiting?.type === 'return_reason') {
      if (NO_RE.test(t)) return { text: 'Okay, no return booked.', toolCalls: [] };
      const reason = text.replace(/^(because|the reason is|reason:?)\s*/i, '').trim() || 'Customer changed their mind';
      const date = DATE_RE.exec(t)?.[1] ?? 'tomorrow';
      const window = WINDOW_RE.exec(t)?.[1]?.toLowerCase() ?? 'morning';
      return turn([call('request_return_pickup', { shipment: prev.awaiting.shipment, reason, pickup_date: date, pickup_window: window })]);
    }

    if (/\b(pay|paying)\b/.test(t) && /\b(duty|customs|fee|it|that)\b/.test(t)) {
      const s = shipment ?? 'phone';
      // Even "yes, pay the duty" without a prior quote gets a quote first.
      return turn([call('pay_customs_duty', { shipment: s, confirm: false })]);
    }
    if (/\b(invoice|receipt|document|documents|id|identity|passport)\b/.test(t) && /\b(sent|send|upload|uploaded|mark|provide|submit|here)\b/.test(t)) {
      return turn([call('upload_customs_document', { shipment: shipment ?? 'phone', document_type: /\b(id|identity|passport)\b/.test(t) ? 'id_proof' : 'commercial_invoice' })]);
    }
    if (/\b(customs|stuck|held|hold)\b/.test(t)) {
      return turn([call('get_customs_status', { shipment: shipment ?? 'phone' })]);
    }
    if (/\b(unit|apartment|apt|suite|wrong address|address)\b/.test(t) && /\d/.test(t)) {
      const unit = /\b(?:unit|apartment|apt|suite|#|is)\s*([0-9]+[a-z]?)\b/i.exec(t)?.[1] ?? /\b([0-9]+[a-z])\b/i.exec(t)?.[1];
      return turn([call('update_delivery_instructions', { shipment: shipment ?? 'coffee machine', instruction_type: 'address_correction', details: unit ?? text })]);
    }
    const instruction = /\b(neighbou?r|next door)\b/.test(t) || /\bwith (sam|[a-z]+) /.test(t)
      ? 'neighbour'
      : /\bback door\b/.test(t)
        ? 'back_door'
        : /\bfront door\b/.test(t)
          ? 'front_door'
          : /\breception\b/.test(t)
            ? 'reception'
            : /\bgate code\b/.test(t)
              ? 'gate_code'
              : null;
    if (instruction && /\b(leave|drop|deliver|put)\b/.test(t) && shipment) {
      const details = instruction === 'neighbour' ? (/\bwith ([a-z]+)\b/i.exec(text)?.[1] ?? undefined) : instruction === 'gate_code' ? /\b(\d{3,})\b/.exec(t)?.[1] : undefined;
      return turn([call('update_delivery_instructions', { shipment, instruction_type: instruction, ...(details ? { details } : {}) })]);
    }
    if (/\b(return|send back|refund)\b/.test(t) && shipment) {
      return turn([call('get_proof_of_delivery', { shipment })], { wantReturn: shipment });
    }
    if (/\b(delivered|proof|photo|where did .* leave|left)\b/.test(t) && shipment) {
      return turn([call('get_proof_of_delivery', { shipment })]);
    }
    const date = DATE_RE.exec(t)?.[1];
    const window = WINDOW_RE.exec(t)?.[1]?.toLowerCase();
    if (shipment && (/\b(reschedule|move|change|come|arrive|deliver)\b/.test(t) || /\bwon'?t be home\b/.test(t)) && (date || /\bslots?\b/.test(t))) {
      if (date && window) {
        return turn([call('get_delivery_slots', { shipment }), call('reschedule_delivery', { shipment, date, window })]);
      }
      return turn([call('get_delivery_slots', { shipment, ...(date ? { from_date: date } : {}) })]);
    }
    if (shipment && /\b(slots?|reschedule|another day|different day|when can)\b/.test(t)) {
      return turn([call('get_delivery_slots', { shipment })]);
    }
    if (named && /\b(where|track|status|when|arrive|eta|coming|update)\b/.test(t)) {
      return turn([call('track_shipment', { shipment: named })]);
    }
    // A specific but unknown parcel name: let the server explain and list the real ones.
    const asked = /\b(?:track|where(?: is|'s)|status of|find)\s+(?:my|the)\s+([a-z0-9 ]+?)(?:\s+(?:parcel|package|delivery|order))?[?.!]*$/i.exec(text.trim());
    if (!named && asked?.[1]) return turn([call('track_shipment', { shipment: asked[1].trim() })]);
    if (/\b(packages?|parcels?|deliveries|delivery|orders?|shipments?|arriving|coming)\b/.test(t) || /\bwhat'?s (coming|arriving)\b/.test(t)) {
      return turn([call('list_active_shipments', { include_delivered: /\b(all|delivered|everything)\b/.test(t) })]);
    }
    if (named) return turn([call('track_shipment', { shipment: named })]);
    return { text: HELP, toolCalls: [] };
  }

  private afterTools(messages: ChatMessage[]): LlmTurn {
    // Collect this turn's assistant tool calls and their results.
    let i = messages.length - 1;
    const results: Extract<ChatMessage, { role: 'tool' }>[] = [];
    while (i >= 0 && messages[i]?.role === 'tool') {
      results.unshift(messages[i] as Extract<ChatMessage, { role: 'tool' }>);
      i -= 1;
    }
    const assistant = messages[i];
    const state = stateOf(assistant);
    const allFailed = results.every((r) => r.isError);

    // Continue a multi-step plan when the previous step worked.
    const [next, ...rest] = state.plan ?? [];
    if (next && !allFailed) {
      return { text: '', toolCalls: [next], raw: { provider: this.id, content: { ...state, plan: rest } } };
    }

    const speeches = results.map((r) => {
      try {
        const parsed = JSON.parse(r.content) as { speech?: string };
        return parsed.speech ?? r.content;
      } catch {
        return r.content;
      }
    });
    // For slots followed by a reschedule, only the final outcome is worth saying.
    let text = (results.length > 1 ? speeches.at(-1) : speeches.join(' ')) ?? '';
    const lastCall = assistant?.role === 'assistant' ? assistant.toolCalls.at(-1) : undefined;
    let awaiting: Awaiting | undefined;
    const shipment = typeof lastCall?.args.shipment === 'string' ? lastCall.args.shipment : undefined;

    if (lastCall?.name === 'pay_customs_duty' && lastCall.args.confirm !== true && !allFailed && shipment) {
      awaiting = { type: 'pay', shipment };
    }
    if (lastCall?.name === 'get_proof_of_delivery' && state.wantReturn && !allFailed && shipment) {
      text += ' I can book a return pickup for tomorrow morning. What is the reason for the return?';
      awaiting = { type: 'return_reason', shipment };
    }
    if (allFailed && results.length) {
      // Keep failures short and actionable.
      text = speeches.at(-1) ?? text;
    }
    return { text, toolCalls: [], raw: { provider: this.id, content: awaiting ? { awaiting } : {} } };
  }
}
