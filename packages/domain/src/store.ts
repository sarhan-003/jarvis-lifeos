// In-memory store, seeded at startup. All operations are synchronous.
import type { Customer, DeliverySlot, DeliveryWindow, ReturnRequest, Shipment } from './schemas.js';
import { DEMO_CUSTOMER, createSeedShipments, createSlots } from './seed.js';

export interface ShipmentStore {
  readonly customer: Customer;
  listShipments(): Shipment[];
  getShipment(id: string): Shipment | undefined;
  saveShipment(shipment: Shipment): void;
  listSlots(): DeliverySlot[];
  findSlot(date: string, window: DeliveryWindow): DeliverySlot | undefined;
  addReturn(request: ReturnRequest): void;
  listReturns(): ReturnRequest[];
  /** The store's notion of "now"; tests can pin it. */
  now(): Date;
  resetDemo(): void;
}

export class InMemoryShipmentStore implements ShipmentStore {
  readonly customer: Customer = structuredClone(DEMO_CUSTOMER);
  private shipments = new Map<string, Shipment>();
  private slots: DeliverySlot[] = [];
  private returns: ReturnRequest[] = [];

  constructor(private readonly clock: () => Date = () => new Date()) {
    this.resetDemo();
  }

  now(): Date {
    return this.clock();
  }

  resetDemo(): void {
    const now = this.clock();
    this.shipments = new Map(createSeedShipments(now).map((s) => [s.id, s]));
    this.slots = createSlots(now);
    this.returns = [];
  }

  listShipments(): Shipment[] {
    return [...this.shipments.values()].map((s) => structuredClone(s));
  }

  getShipment(id: string): Shipment | undefined {
    const s = this.shipments.get(id);
    return s ? structuredClone(s) : undefined;
  }

  saveShipment(shipment: Shipment): void {
    this.shipments.set(shipment.id, structuredClone(shipment));
  }

  listSlots(): DeliverySlot[] {
    return this.slots.map((s) => ({ ...s }));
  }

  findSlot(date: string, window: DeliveryWindow): DeliverySlot | undefined {
    const slot = this.slots.find((s) => s.date === date && s.window === window);
    return slot ? { ...slot } : undefined;
  }

  addReturn(request: ReturnRequest): void {
    this.returns.push({ ...request });
  }

  listReturns(): ReturnRequest[] {
    return this.returns.map((r) => ({ ...r }));
  }
}
