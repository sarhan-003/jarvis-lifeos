import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DeliveryWindowSchema, InstructionTypeSchema, type DeliveryWindow, type InstructionType } from '@parcel/domain';
import { READ_ONLY, SHIPMENT_ARG, WRITE, resultEnvelope, toResult, withLogging, type ToolContext } from './shared.js';

const DATE_ARG = z
  .string()
  .min(1)
  .describe('Date as YYYY-MM-DD, or a word like "tomorrow" or "saturday" (resolved relative to today)');

export function registerDeliveryTools(server: McpServer, { service }: ToolContext): void {
  server.registerTool(
    'get_delivery_slots',
    {
      title: 'Get delivery slots',
      description:
        'Use when the user wants to change when a parcel arrives or asks when it could come instead. Returns up to nine available slots (morning 8-12, afternoon 12-4, evening 4-8) in the next week.',
      inputSchema: { shipment: SHIPMENT_ARG, from_date: DATE_ARG.optional().describe('Only slots on or after this date') },
      outputSchema: resultEnvelope(),
      annotations: READ_ONLY,
    },
    withLogging('get_delivery_slots', ({ shipment, from_date }: { shipment: string; from_date?: string }) =>
      toResult(service.getDeliverySlots(shipment, from_date)),
    ),
  );

  server.registerTool(
    'reschedule_delivery',
    {
      title: 'Reschedule delivery',
      description:
        'Use to move a parcel to a specific available delivery slot after the user picked one. Fails if the slot is full or the parcel is delivered, not yet shipped, or held in customs.',
      inputSchema: { shipment: SHIPMENT_ARG, date: DATE_ARG, window: DeliveryWindowSchema.describe('morning, afternoon or evening') },
      outputSchema: resultEnvelope(),
      annotations: WRITE,
    },
    withLogging('reschedule_delivery', ({ shipment, date, window }: { shipment: string; date: string; window: DeliveryWindow }) =>
      toResult(service.rescheduleDelivery(shipment, date, window)),
    ),
  );

  server.registerTool(
    'update_delivery_instructions',
    {
      title: 'Update delivery instructions',
      description:
        'Use when the user says where to leave a parcel (front door, back door, with a neighbour, at reception, a gate code) or corrects the address, e.g. adds a missing unit number. An address correction also fixes a failed delivery.',
      inputSchema: {
        shipment: SHIPMENT_ARG,
        instruction_type: InstructionTypeSchema.describe('front_door, back_door, neighbour, reception, gate_code or address_correction'),
        details: z.string().optional().describe('Extra detail: the neighbour\'s name, the gate code, or the unit number for address_correction'),
      },
      outputSchema: resultEnvelope(),
      annotations: WRITE,
    },
    withLogging(
      'update_delivery_instructions',
      ({ shipment, instruction_type, details }: { shipment: string; instruction_type: InstructionType; details?: string }) =>
        toResult(service.updateDeliveryInstructions(shipment, instruction_type, details)),
    ),
  );
}
