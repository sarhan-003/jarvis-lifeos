// The Parcel Concierge MCP server definition (tools only; transport lives in app.ts).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ParcelConcierge } from '@parcel/domain';
import { registerShipmentTools } from './tools/shipments.js';
import { registerCustomsTools } from './tools/customs.js';
import { registerDeliveryTools } from './tools/delivery.js';
import { registerReturnTools } from './tools/returns.js';

export const SERVER_INFO = { name: 'parcel-concierge', title: 'Parcel Concierge', version: '1.0.0' } as const;

export function createParcelServer(service: ParcelConcierge): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'Parcel Concierge manages SwiftLane Express deliveries for the signed-in customer: tracking, customs holds and duty, delivery slots and instructions, proof of delivery and returns. Users refer to parcels by nickname, such as "my phone". Payments are two-step: quote with confirm=false, then pay with confirm=true only after the user agrees.',
  });
  const ctx = { service };
  registerShipmentTools(server, ctx);
  registerCustomsTools(server, ctx);
  registerDeliveryTools(server, ctx);
  registerReturnTools(server, ctx);
  return server;
}
