import type { Brand, ExternalIdType, ExternalSystem } from '../enums/index.js';

export interface ExternalId {
  readonly id: string;
  readonly customerId: string;
  readonly brand: Brand;
  readonly system: ExternalSystem;
  readonly idType: ExternalIdType;
  readonly value: string;
  readonly createdAt: Date;
}
