// Protocol-level tests: a real MCP SDK client over Streamable HTTP.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryShipmentStore, ParcelConcierge } from '@parcel/domain';
import { createApp } from '../src/app.js';

const store = new InMemoryShipmentStore();
let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({ store, service: new ParcelConcierge(store) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

async function connect() {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

const ALL_TOOLS = [
  'get_customs_status',
  'get_delivery_slots',
  'get_proof_of_delivery',
  'list_active_shipments',
  'pay_customs_duty',
  'request_return_pickup',
  'reschedule_delivery',
  'track_shipment',
  'update_delivery_instructions',
  'upload_customs_document',
];

describe('Parcel Concierge MCP server', () => {
  it('negotiates protocol 2025-11-25 over Streamable HTTP', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const json = JSON.parse(res.headers.get('content-type')?.includes('event-stream') ? (/^data: (.+)$/m.exec(text)?.[1] ?? '{}') : text);
    expect(json.result.protocolVersion).toBe('2025-11-25');
    expect(json.result.serverInfo.name).toBe('parcel-concierge');
  });

  it('lists all 10 tools with schemas and annotations', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
      expect(t.outputSchema?.type).toBe('object');
    }
    expect(tools.find((t) => t.name === 'track_shipment')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'pay_customs_duty')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
    await client.close();
  });

  it('every tool returns spoken text and structuredContent', async () => {
    store.resetDemo();
    const client = await connect();
    const calls: [string, Record<string, unknown>][] = [
      ['list_active_shipments', {}],
      ['track_shipment', { shipment: 'books' }],
      ['get_customs_status', { shipment: 'my phone' }],
      ['pay_customs_duty', { shipment: 'phone', confirm: false }],
      ['upload_customs_document', { shipment: 'phone', document_type: 'commercial_invoice' }],
      ['get_delivery_slots', { shipment: 'books' }],
      ['reschedule_delivery', { shipment: 'books', date: 'saturday', window: 'evening' }],
      ['update_delivery_instructions', { shipment: 'running shoes', instruction_type: 'neighbour', details: 'Sam' }],
      ['get_proof_of_delivery', { shipment: 'headphones' }],
      ['request_return_pickup', { shipment: 'headphones', reason: 'Too tight', pickup_date: 'tomorrow', pickup_window: 'morning' }],
    ];
    for (const [name, args] of calls) {
      const r = await client.callTool({ name, arguments: args });
      expect(r.isError, `${name}: ${JSON.stringify(r.content)}`).toBe(false);
      const content = r.content as { type: string; text: string }[];
      expect(content[0]?.type).toBe('text');
      expect(content[0]?.text).not.toMatch(/[*#]/); // spoken-friendly, no markdown
      expect((r.structuredContent as { ok: boolean }).ok).toBe(true);
    }
    await client.close();
  });

  it('payment is two-step: confirm=false never pays', async () => {
    store.resetDemo();
    const client = await connect();
    const quote = await client.callTool({ name: 'pay_customs_duty', arguments: { shipment: 'phone' } });
    expect((quote.structuredContent as { confirmed: boolean }).confirmed).toBe(false);
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(false);
    const paid = await client.callTool({ name: 'pay_customs_duty', arguments: { shipment: 'phone', confirm: true } });
    expect((paid.structuredContent as { paymentReference: string }).paymentReference).toMatch(/^SLX-PAY-\d{6}$/);
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(true);
    await client.close();
  });

  it('errors are helpful results, not exceptions', async () => {
    const client = await connect();
    const r = await client.callTool({ name: 'track_shipment', arguments: { shipment: 'tv' } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]?.text).toContain('You have:');
    await client.close();
  });

  it('stateless endpoint: GET/DELETE are 405, health and call log work', async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: 'DELETE' })).status).toBe(405);
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({ ok: true });
    const { calls } = (await (await fetch(`${base}/debug/calls`)).json()) as { calls: { name: string; durationMs: number }[] };
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.durationMs < 50)).toBe(true);
  });

  it('reset restores the demo data', async () => {
    store.resetDemo();
    const client = await connect();
    await client.callTool({ name: 'pay_customs_duty', arguments: { shipment: 'phone', confirm: true } });
    await fetch(`${base}/debug/reset`, { method: 'POST' });
    expect(store.getShipment('shp_phone')?.customs?.isPaid).toBe(false);
    await client.close();
  });
});
