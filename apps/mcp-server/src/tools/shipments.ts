import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { READ_ONLY, SHIPMENT_ARG, resultEnvelope, toResult, withLogging, type ToolContext } from './shared.js';

export function registerShipmentTools(server: McpServer, { service }: ToolContext): void {
  server.registerTool(
    'list_active_shipments',
    {
      title: 'List active shipments',
      description:
        'Use when the user asks where their packages are or what is arriving. Lists parcels that are not yet delivered, soonest first, and flags any that need action (customs, failed delivery). Set include_delivered to also list delivered parcels.',
      inputSchema: { include_delivered: z.boolean().default(false).describe('Also include delivered parcels') },
      outputSchema: resultEnvelope({ count: z.number().optional(), shipments: z.array(z.record(z.string(), z.unknown())).optional() }),
      annotations: READ_ONLY,
    },
    withLogging('list_active_shipments', ({ include_delivered }: { include_delivered?: boolean }) =>
      toResult(service.listActiveShipments({ includeDelivered: include_delivered ?? false })),
    ),
  );

  server.registerTool(
    'track_shipment',
    {
      title: 'Track a shipment',
      description:
        'Use when the user asks where a specific parcel is or when it will arrive. Users name parcels by nickname ("my phone"); a tracking number also works. Returns status, ETA and delivery window, the last five tracking events and delivery instructions.',
      inputSchema: { shipment: SHIPMENT_ARG },
      outputSchema: resultEnvelope(),
      annotations: READ_ONLY,
    },
    withLogging('track_shipment', ({ shipment }: { shipment: string }) => toResult(service.trackShipment(shipment))),
  );
}
