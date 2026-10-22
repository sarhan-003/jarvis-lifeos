// API and card types come from the domain package (type-only, no runtime code).
export type {
  Card,
  CardType,
  ChatResponse,
  ConfirmationData,
  CustomsView,
  DeliverySlot,
  DeliveryWindow,
  HealthResponse,
  ShipmentStatus,
  ShipmentSummary,
  ToolCallTrace,
  TrackingView,
} from '@parcel/domain';

export type Status = 'idle' | 'listening' | 'thinking' | 'speaking';
