import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { Brand } from '../enums/index.js';

import { customer } from './customer.table.js';

export const customerAddress = pgTable(
  'customer_address',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),

    brand: text('brand').notNull().$type<Brand>(),

    sfccAddressId: text('sfcc_address_id'),

    // SFCC `addresses[].firstName`
    firstName: text('first_name'),
    // SFCC `addresses[].lastName`
    lastName: text('last_name'),

    // SFCC `addresses[].address1`
    street1: text('street1'),
    // SFCC `addresses[].address2`
    street2: text('street2'),
    // SFCC `addresses[].city`
    city: text('city'),
    // SFCC `addresses[].stateCode`
    stateCode: text('state_code'),
    // SFCC `addresses[].postalCode`, stored uppercase without spaces
    postalCode: text('postal_code'),
    // SFCC `addresses[].countryCode`, ISO alpha-2
    countryCode: text('country_code'),

    // SFCC `addresses[].phone`
    phone: text('phone'),
    // SFCC/Mondou `addresses[].c_phoneType` — "mobile" | "home"
    phoneType: text('phone_type'),

    // SFCC `addresses[].preferred` — ONE flag per address, not one per purpose
    isPreferred: boolean('is_preferred').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('customer_address_preferred_uq')
      .on(t.customerId)
      .where(sql`is_preferred`),

    uniqueIndex('customer_address_sfcc_id_uq')
      .on(t.customerId, t.sfccAddressId)
      .where(sql`sfcc_address_id IS NOT NULL`),
  ],
);
