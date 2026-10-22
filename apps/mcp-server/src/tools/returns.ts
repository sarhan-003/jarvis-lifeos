import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DeliveryWindowSchema, type DeliveryWindow } from '@parcel/domain';
import { READ_ONLY, SHIPMENT_ARG, WRITE, resultEnvelope, toResult, withLogging, type ToolContext } from './shared.js';

export function registerReturnTools(server: McpServer, { service }: ToolContext): void {
  server.registerTool(
    'get_proof_of_delivery',
    {
      title: 'Get proof of delivery',
      description: 'Use when the user asks whether a parcel was delivered, when, or where it was left. Returns the delivery time, location and photo reference.',
      inputSchema: { shipment: SHIPMENT_ARG },
      outputSchema: resultEnvelope(),
      annotations: READ_ONLY,
    },
    withLogging('get_proof_of_delivery', ({ shipment }: { shipment: string }) => toResult(service.getProofOfDelivery(shipment))),
  );

  server.registerTool(
    'request_return_pickup',
    {
      title: 'Request return pickup',
      description:
        'Use when the user wants to return a delivered parcel. Books a courier pickup (only within the return window) and emails a QR code (simulated). Ask for a reason and a pickup day if the user did not give them.',
      inputSchema: {
        shipment: SHIPMENT_ARG,
        reason: z.string().min(1).describe('Why the user is returning it, in their words'),
        pickup_date: z.string().min(1).describe('Pickup date as YYYY-MM-DD or a word like "tomorrow" or "monday"'),
        pickup_window: DeliveryWindowSchema.describe('morning, afternoon or evening'),
      },
      outputSchema: resultEnvelope(),
      annotations: WRITE,
    },
    withLogging(
      'request_return_pickup',
      ({ shipment, reason, pickup_date, pickup_window }: { shipment: string; reason: string; pickup_date: string; pickup_window: DeliveryWindow }) =>
        toResult(service.requestReturnPickup(shipment, reason, pickup_date, pickup_window)),
    ),
  );
}
