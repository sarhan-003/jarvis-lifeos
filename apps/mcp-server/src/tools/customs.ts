import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DocumentTypeSchema, type DocumentType } from '@parcel/domain';
import { READ_ONLY, SHIPMENT_ARG, WRITE, resultEnvelope, toResult, withLogging, type ToolContext } from './shared.js';

export function registerCustomsTools(server: McpServer, { service }: ToolContext): void {
  server.registerTool(
    'get_customs_status',
    {
      title: 'Get customs status',
      description:
        'Use when the user asks why a parcel is stuck or held in customs, or what customs needs. Explains hold reasons in plain English, missing documents, the HS code, the duty breakdown (value x rate + processing fee), whether it is paid, and the next step.',
      inputSchema: { shipment: SHIPMENT_ARG },
      outputSchema: resultEnvelope(),
      annotations: READ_ONLY,
    },
    withLogging('get_customs_status', ({ shipment }: { shipment: string }) => toResult(service.getCustomsStatus(shipment))),
  );

  server.registerTool(
    'pay_customs_duty',
    {
      title: 'Pay customs duty',
      description:
        'Two-step payment of import duty with the payment method on file. ALWAYS call first with confirm=false to get the amount and read it to the user; only call with confirm=true after the user clearly says yes. Never ask for card details.',
      inputSchema: {
        shipment: SHIPMENT_ARG,
        confirm: z.boolean().default(false).describe('false = quote the amount only; true = actually pay (only after the user said yes)'),
      },
      outputSchema: resultEnvelope({ confirmed: z.boolean().optional(), amountUsd: z.number().optional() }),
      annotations: WRITE,
    },
    withLogging('pay_customs_duty', ({ shipment, confirm }: { shipment: string; confirm?: boolean }) =>
      toResult(service.payCustomsDuty(shipment, confirm === true)),
    ),
  );

  server.registerTool(
    'upload_customs_document',
    {
      title: 'Upload customs document',
      description:
        'Use when the user says they sent or want to provide a document customs asked for (commercial invoice or proof of ID). Marks it received (simulated: an upload link is sent to their phone) and releases the parcel if nothing else is blocking.',
      inputSchema: {
        shipment: SHIPMENT_ARG,
        document_type: DocumentTypeSchema.describe('commercial_invoice or id_proof'),
      },
      outputSchema: resultEnvelope(),
      annotations: WRITE,
    },
    withLogging('upload_customs_document', ({ shipment, document_type }: { shipment: string; document_type: DocumentType }) =>
      toResult(service.uploadCustomsDocument(shipment, document_type)),
    ),
  );
}
