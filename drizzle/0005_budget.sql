CREATE TABLE "budget" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" numeric,
	"currency" text NOT NULL,
	"effective_from" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_effective_from_format" CHECK ("budget"."effective_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budget_amount_positive" CHECK ("budget"."amount" is null or "budget"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_user_category_month_uidx" ON "budget" USING btree ("user_id","category_id","effective_from");