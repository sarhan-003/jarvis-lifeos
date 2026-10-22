// End to end: agent tool loop -> MCP client -> Streamable HTTP -> Parcel
// Concierge MCP server -> in-memory store. Uses the offline engine (no keys).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { InMemoryShipmentStore, ParcelConcierge, isoDate, resolveDate, type ChatResponse } from '@parcel/domain';
import { createApp as createMcpApp } from '../../mcp-server/src/app.js';
import { McpToolGateway } from '../src/mcpClient.js';
import { chooseProvider } from '../src/providers.js';
import { runChat } from '../src/chat.js';
import { loadEnv } from '../src/env.js';
import { LlmError, type ChatMessage, type LlmProvider } from '../src/llm/provider.js';
import { createAgentApp } from '../src/app.js';

const store = new InMemoryShipmentStore();
let mcp: Server;
let gateway: McpToolGateway;
let mcpUrl: string;

beforeAll(async () => {
  const app = createMcpApp({ store, service: new ParcelConcierge(store) });
  await new Promise<void>((resolve) => {
    mcp = app.listen(0, '127.0.0.1', () => resolve());
  });
  const a = mcp.address();
  mcpUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/mcp`;
  gateway = new McpToolGateway(mcpUrl);
});

afterAll(() => {
  mcp.close();
});

beforeEach(() => store.resetDemo());

function conversation() {
  const env = loadEnv({ LLM_PROVIDER: 'offline', MCP_SERVER_URL: mcpUrl });
  const { provider, offline } = chooseProvider(env, gateway);
  let history: ChatMessage[] = [];
  return async (message: string): Promise<ChatResponse> => {
    const out = await runChat({ provider, offline, gateway, history, message });
    history = out.history;
    return out.response;
  };
}

const tools = (r: ChatResponse) => r.toolCalls.map((t) => t.name);

describe('demo utterances (offline engine, real MCP server)', () => {
  it('1. "Where are my packages?"', async () => {
    const r = await conversation()('Where are my packages?');
    expect(tools(r)).toEqual(['list_active_shipments']);
    expect(r.cards[0]?.type).toBe('shipment_list');
    expect(r.speech).toMatch(/^You have five parcels on the way/);
  });

  it('2-4. customs: why stuck, quote, pay on yes, upload invoice', async () => {
    const say = conversation();
    const why = await say('Why is my phone stuck in customs?');
    expect(tools(why)).toEqual(['get_customs_status']);
    expect(why.cards[0]?.type).toBe('customs');

    const quote = await say('Okay, pay the duty.');
    expect(r(quote)).toEqual([['pay_customs_duty', { shipment: 'phone', confirm: false }]]);
    expect(quote.speech).toContain('Should I pay it?');
    expect(quote.cards[0]).toMatchObject({ type: 'confirmation', data: { kind: 'payment_quote', needsAnswer: true } });
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(false);

    const paid = await say('Yes');
    expect(r(paid)).toEqual([['pay_customs_duty', { shipment: 'phone', confirm: true }]]);
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(true);
    expect(paid.cards[0]).toMatchObject({ type: 'confirmation', data: { kind: 'payment_done' } });

    const doc = await say('I sent the invoice — mark it uploaded.');
    expect(r(doc)).toEqual([['upload_customs_document', { shipment: 'phone', document_type: 'commercial_invoice' }]]);
    expect(store.getShipment('shp_phone')?.status).toBe('ArrivedInCountry');
  });

  it('3b. "No" after a quote does not pay', async () => {
    const say = conversation();
    await say('Why is my phone stuck in customs?');
    await say('Okay, pay the duty.');
    const no = await say('No, cancel');
    expect(no.toolCalls).toHaveLength(0);
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(false);
  });

  it('5. "can the books come Saturday evening?" -> slots then reschedule', async () => {
    const r1 = await conversation()("I won't be home tomorrow, can the books come Saturday evening?");
    expect(tools(r1)).toEqual(['get_delivery_slots', 'reschedule_delivery']);
    expect(r1.cards.map((c) => c.type)).toEqual(['confirmation']);
    expect(r1.toolCalls[1]?.args).toMatchObject({ date: 'saturday', window: 'evening' });
    const books = store.getShipment('shp_books');
    expect(books?.eta).toBe(resolveDate('saturday', isoDate(new Date())));
    expect(books?.deliveryWindow).toBe('evening');
  });

  it('6. "Leave my running shoes with Sam next door."', async () => {
    const res = await conversation()('Leave my running shoes with Sam next door.');
    expect(r(res)).toEqual([['update_delivery_instructions', { shipment: 'running shoes', instruction_type: 'neighbour', details: 'Sam' }]]);
    expect(store.getShipment('shp_shoes')?.deliveryInstructions).toBe('Leave with Sam in 4B');
  });

  it('7. "The coffee machine delivery failed — my unit is 12B."', async () => {
    const res = await conversation()('The coffee machine delivery failed — my unit is 12B.');
    expect(r(res)).toEqual([['update_delivery_instructions', { shipment: 'coffee machine', instruction_type: 'address_correction', details: '12b' }]]);
    expect(store.getShipment('shp_coffee')?.status).toBe('InTransit');
  });

  it('8. headphones delivered? -> return pickup after giving a reason', async () => {
    const say = conversation();
    const pod = await say('Was my headphones parcel delivered? I want to return them.');
    expect(tools(pod)).toEqual(['get_proof_of_delivery']);
    expect(pod.cards[0]?.type).toBe('pod');
    expect(pod.speech).toContain('What is the reason for the return?');
    const ret = await say("They don't fit well");
    expect(tools(ret)).toEqual(['request_return_pickup']);
    expect(ret.cards[0]?.type).toBe('return');
    expect(store.getShipment('shp_headphones')?.status).toBe('ReturnRequested');
  });

  it('slot chip phrasing from the UI works', async () => {
    const slot = store.listSlots().find((s) => s.available)!;
    const res = await conversation()(`Reschedule my books to ${slot.date} ${slot.window}`);
    expect(tools(res)).toEqual(['get_delivery_slots', 'reschedule_delivery']);
    expect(store.getShipment('shp_books')?.eta).toBe(slot.date);
  });

  it('unknown parcels produce an error card that lists the options', async () => {
    for (const phrase of ['Track my tv', 'Where is my television parcel?']) {
      const res = await conversation()(phrase);
      expect(tools(res)).toEqual(['track_shipment']);
      expect(res.cards[0]?.type).toBe('error');
      if (res.cards[0]?.type === 'error') expect(res.cards[0].data.candidates).toContain('phone');
      expect(res.speech).toContain("I couldn't find a parcel called");
    }
  });
});

function r(res: ChatResponse) {
  return res.toolCalls.map((t) => [t.name, t.args]);
}

describe('tool loop with a scripted LLM', () => {
  it('feeds tool results back and returns the final text', async () => {
    const seen: ChatMessage[][] = [];
    const scripted: LlmProvider = {
      id: 'fake',
      label: 'Fake LLM',
      async chat({ messages }) {
        seen.push([...messages]);
        if (messages.at(-1)?.role === 'user') return { text: '', toolCalls: [{ id: 't1', name: 'track_shipment', args: { shipment: 'books' } }] };
        return { text: 'Your books arrive soon.', toolCalls: [] };
      },
    };
    const env = loadEnv({ MCP_SERVER_URL: mcpUrl });
    const { offline } = chooseProvider(env, gateway);
    const out = await runChat({ provider: scripted, offline, gateway, history: [], message: 'Where are my books?' });
    expect(out.response.speech).toBe('Your books arrive soon.');
    expect(out.response.cards[0]?.type).toBe('timeline');
    const toolMsg = seen[1]?.at(-1);
    expect(toolMsg?.role).toBe('tool');
    expect(JSON.parse(toolMsg?.role === 'tool' ? toolMsg.content : '{}').ok).toBe(true);
  });

  it('falls back to the offline engine when the LLM fails before any tool ran', async () => {
    const broken: LlmProvider = {
      id: 'broken',
      label: 'Broken LLM',
      async chat() {
        throw new LlmError('Invalid API key', 401);
      },
    };
    const env = loadEnv({ MCP_SERVER_URL: mcpUrl });
    const { offline } = chooseProvider(env, gateway);
    const out = await runChat({ provider: broken, offline, gateway, history: [], message: 'Where are my packages?' });
    expect(out.response.notice).toMatch(/Broken LLM failed \(401: Invalid API key\)/);
    expect(out.response.toolCalls.map((t) => t.name)).toEqual(['list_active_shipments']);
  });
});

describe('HTTP API', () => {
  it('serves /api/chat, /api/health and /api/reset', async () => {
    const env = loadEnv({ LLM_PROVIDER: 'offline', MCP_SERVER_URL: mcpUrl });
    const app = createAgentApp({ env, gateway });
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const a = server.address();
    const base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    try {
      const health = await (await fetch(`${base}/api/health`)).json();
      expect(health).toMatchObject({ ok: true, mcp: { reachable: true, tools: 10 } });

      const bad = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 's', message: ' ' }) });
      expect(bad.status).toBe(400);

      const post = (message: string) =>
        fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 's1', message }) }).then((x) => x.json() as Promise<ChatResponse>);
      await post('Why is my phone stuck in customs?');
      const paid = await (await post('Okay, pay the duty.'), post('Yes'));
      expect(paid.toolCalls[0]?.args).toEqual({ shipment: 'phone', confirm: true });

      const reset = await (await fetch(`${base}/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 's1' }) })).json();
      expect(reset).toEqual({ ok: true, dataReset: true });
      expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(false);
    } finally {
      server.close();
    }
  });
});
