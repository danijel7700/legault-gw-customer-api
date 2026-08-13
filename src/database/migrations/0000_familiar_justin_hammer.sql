CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand" text NOT NULL,
	"email" text,
	"first_name" text,
	"last_name" text NOT NULL,
	"salutation" text,
	"gender" text,
	"birth_date" date,
	"language" text,
	"phone_home" text,
	"phone_mobile" text,
	"postal_code" text,
	"preferred_store" text,
	"source" text NOT NULL,
	"last_modified_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_address" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"sfcc_address_id" text,
	"first_name" text,
	"last_name" text,
	"street1" text,
	"street2" text,
	"city" text,
	"state_code" text,
	"postal_code" text,
	"country_code" text,
	"phone" text,
	"phone_type" text,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_external_id" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"brand" text NOT NULL,
	"system" text NOT NULL,
	"id_type" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_external_id" ADD CONSTRAINT "customer_external_id_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_brand_email_uq" ON "customer" USING btree ("brand","email") WHERE email IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_address_preferred_uq" ON "customer_address" USING btree ("customer_id") WHERE is_preferred;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_address_sfcc_id_uq" ON "customer_address" USING btree ("customer_id","sfcc_address_id") WHERE sfcc_address_id IS NOT NULL;--> statement-breakpoint
-- INCLUDE (customer_id) is hand-added: drizzle-orm 0.45.2 has no DSL for covering
-- indexes. It makes the resolve lookup an index-only scan, and this is the index
-- every authenticated request hits. `db:generate` diffs the snapshot against the
-- TypeScript schema and never sees this, so it will not be dropped — but
-- `drizzle-kit push` would. See "The database layer" in the root README.
CREATE UNIQUE INDEX "customer_external_id_uq" ON "customer_external_id" USING btree ("brand","system","id_type","value") INCLUDE ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_external_id_customer_idx" ON "customer_external_id" USING btree ("customer_id");