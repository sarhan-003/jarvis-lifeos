// Domain model for SwiftLane Express (a fictional carrier). Zod schemas are
// the source of truth; TypeScript types are inferred from them.
import { z } from 'zod';

export const ShipmentStatusSchema = z.enum([
  'LabelCreated',
  'InTransit',
  'ArrivedInCountry',
  'CustomsHold',
  'OutForDelivery',
  'Delivered',
  'DeliveryException',
  'ReturnRequested',
]);
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;

export const DeliveryWindowSchema = z.enum(['morning', 'afternoon', 'evening']);
export type DeliveryWindow = z.infer<typeof DeliveryWindowSchema>;

export const WINDOW_LABELS: Record<DeliveryWindow, string> = {
  morning: '8 AM to 12 PM',
  afternoon: '12 PM to 4 PM',
  evening: '4 PM to 8 PM',
};

export const HoldReasonSchema = z.enum(['DOC_MISSING_INVOICE', 'DUTY_UNPAID', 'ID_VERIFICATION']);
export type HoldReason = z.infer<typeof HoldReasonSchema>;

export const HOLD_REASON_TEXT: Record<HoldReason, string> = {
  DOC_MISSING_INVOICE: 'Customs needs the commercial invoice showing what you paid.',
  DUTY_UNPAID: 'Import duty has been assessed and needs to be paid before release.',
  ID_VERIFICATION: "Customs needs to verify the recipient's identity.",
};

export const DocumentTypeSchema = z.enum(['commercial_invoice', 'id_proof']);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const InstructionTypeSchema = z.enum(['front_door', 'back_door', 'neighbour', 'reception', 'gate_code', 'address_correction']);
export type InstructionType = z.infer<typeof InstructionTypeSchema>;

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  defaultAddress: z.string(),
  neighbours: z.array(z.object({ name: z.string(), unit: z.string() })),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const TrackingEventSchema = z.object({
  timestamp: z.string(),
  location: z.string(),
  code: z.string(),
  description: z.string(),
});
export type TrackingEvent = z.infer<typeof TrackingEventSchema>;

export const CustomsCaseSchema = z.object({
  holdReasonCodes: z.array(HoldReasonSchema),
  missingDocuments: z.array(DocumentTypeSchema),
  hsCode: z.string(),
  dutyRatePercent: z.number(),
  dutyAmountUsd: z.number(),
  processingFeeUsd: z.number(),
  isPaid: z.boolean(),
  paymentReference: z.string().optional(),
});
export type CustomsCase = z.infer<typeof CustomsCaseSchema>;

export const ProofOfDeliverySchema = z.object({
  deliveredAt: z.string(),
  leftAt: z.string(),
  photoRef: z.string(),
  signedBy: z.string().optional(),
});
export type ProofOfDelivery = z.infer<typeof ProofOfDeliverySchema>;

export const ShipmentSchema = z.object({
  id: z.string(),
  trackingNumber: z.string(),
  customerId: z.string(),
  nickname: z.string(),
  itemDescription: z.string(),
  merchant: z.string(),
  declaredValueUsd: z.number(),
  origin: z.string(),
  destination: z.string(),
  status: ShipmentStatusSchema,
  /** Calendar date YYYY-MM-DD */
  eta: z.string().optional(),
  deliveryWindow: DeliveryWindowSchema.optional(),
  events: z.array(TrackingEventSchema),
  deliveryInstructions: z.string().optional(),
  exceptionReason: z.string().optional(),
  customs: CustomsCaseSchema.optional(),
  proofOfDelivery: ProofOfDeliverySchema.optional(),
  /** Calendar date YYYY-MM-DD */
  returnEligibleUntil: z.string().optional(),
});
export type Shipment = z.infer<typeof ShipmentSchema>;

export const DeliverySlotSchema = z.object({
  date: z.string(),
  window: DeliveryWindowSchema,
  available: z.boolean(),
});
export type DeliverySlot = z.infer<typeof DeliverySlotSchema>;

export const ReturnRequestSchema = z.object({
  id: z.string(),
  shipmentId: z.string(),
  reason: z.string(),
  pickupDate: z.string(),
  pickupWindow: DeliveryWindowSchema,
});
export type ReturnRequest = z.infer<typeof ReturnRequestSchema>;
