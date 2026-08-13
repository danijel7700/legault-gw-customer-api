import { relations } from 'drizzle-orm';

import { customerAddress } from './customer-address.table.js';
import { customerExternalId } from './customer-external-id.table.js';
import { customer } from './customer.table.js';

export const customerRelations = relations(customer, ({ many }) => ({
  externalIds: many(customerExternalId),
  addresses: many(customerAddress),
}));

export const customerExternalIdRelations = relations(customerExternalId, ({ one }) => ({
  customer: one(customer, {
    fields: [customerExternalId.customerId],
    references: [customer.id],
  }),
}));

export const customerAddressRelations = relations(customerAddress, ({ one }) => ({
  customer: one(customer, {
    fields: [customerAddress.customerId],
    references: [customer.id],
  }),
}));
