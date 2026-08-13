import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { Brand, ExternalSystem } from '../enums/index.js';

import { customer } from './customer.table.js';

export const customerExternalId = pgTable(
  'customer_external_id',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),

    brand: text('brand').notNull().$type<Brand>(),
    system: text('system').notNull().$type<ExternalSystem>(),

    idType: text('id_type').notNull(),
    value: text('value').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('customer_external_id_uq').on(t.brand, t.system, t.idType, t.value),

    index('customer_external_id_customer_idx').on(t.customerId),
  ],
);
