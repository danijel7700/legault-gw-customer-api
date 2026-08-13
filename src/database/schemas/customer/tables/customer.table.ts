import { sql } from 'drizzle-orm';
import { date, integer, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';

import type { Brand, Gender, Language, SourceSystem } from '../enums/index.js';

export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // From the auth context, never from a source payload.
    brand: text('brand').notNull().$type<Brand>(),

    // SFCC `email` (SFCC `login` carries the same value).
    // Null when only a placeholder exists — see normalizeEmail in ../utils.
    email: text('email'),

    // SFCC `firstName`, max 40
    firstName: text('first_name'),
    // SFCC `lastName`, max 80.
    lastName: text('last_name'),

    // SFSC `Salutation`, NAV `salutationCode`
    salutation: text('salutation'),
    // SFSC `PersonGenderIdentity`
    gender: text('gender').$type<Gender>(),
    // SFSC `PersonBirthdate` — date only, no time
    birthDate: date('birth_date', { mode: 'string' }),
    // SFCC `preferredLocale` normalized to en | fr
    language: text('language').$type<Language>(),

    // SFCC `phoneHome`
    phoneHome: text('phone_home'),
    // SFCC `phoneMobile`
    phoneMobile: text('phone_mobile'),

    // SFSC `PersonMailingPostalCode` — account-level, separate from any address entry
    postalCode: text('postal_code'),
    // SFCC `c_preferredStore` — Ren's slugs ("liberty-village"), Mondou numbers ("2078")
    preferredStore: text('preferred_store'),

    // System the record originated from
    source: text('source').notNull().$type<SourceSystem>(),
    // System that caused the most recent write
    lastModifiedBy: text('last_modified_by').notNull().$type<SourceSystem>(),
    // Optimistic concurrency, exposed as ETag
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('customer_brand_email_uq')
      .on(t.brand, t.email)
      .where(sql`email IS NOT NULL`),
  ],
);
