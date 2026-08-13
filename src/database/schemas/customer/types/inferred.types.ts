import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import type { customer, customerAddress, customerExternalId } from '../tables/index.js';

export type CustomerRow = InferSelectModel<typeof customer>;
export type NewCustomerRow = InferInsertModel<typeof customer>;

export type CustomerExternalIdRow = InferSelectModel<typeof customerExternalId>;
export type NewCustomerExternalIdRow = InferInsertModel<typeof customerExternalId>;

export type CustomerAddressRow = InferSelectModel<typeof customerAddress>;
export type NewCustomerAddressRow = InferInsertModel<typeof customerAddress>;
