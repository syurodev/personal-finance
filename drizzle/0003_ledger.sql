CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_kind_check" CHECK ("category"."kind" in ('expense', 'income'))
);
--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"opening_balance" numeric DEFAULT '0' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_account_type_check" CHECK ("ledger_account"."type" in ('cash', 'bank', 'credit_card', 'ewallet'))
);
--> statement-breakpoint
CREATE TABLE "ledger_transaction" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category_id" uuid,
	"amount" numeric NOT NULL,
	"currency" text NOT NULL,
	"occurred_on" date NOT NULL,
	"transfer_group_id" uuid,
	"description" text,
	"merchant" text,
	"note" text,
	"source_client_id" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transaction_kind_check" CHECK ("ledger_transaction"."kind" in ('standard', 'transfer', 'adjustment')),
	CONSTRAINT "ledger_transaction_amount_nonzero" CHECK ("ledger_transaction"."amount" <> 0),
	CONSTRAINT "ledger_transaction_category_only_standard" CHECK ("ledger_transaction"."category_id" is null or "ledger_transaction"."kind" = 'standard'),
	CONSTRAINT "ledger_transaction_transfer_group" CHECK (("ledger_transaction"."kind" = 'transfer') = ("ledger_transaction"."transfer_group_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_account_id_ledger_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transaction" ADD CONSTRAINT "ledger_transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_user_kind_parent_name_uidx" ON "category" USING btree ("user_id","kind",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "category"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_account_user_name_uidx" ON "ledger_account" USING btree ("user_id",lower("name")) WHERE "ledger_account"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "ledger_transaction_user_date_idx" ON "ledger_transaction" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "ledger_transaction_account_date_idx" ON "ledger_transaction" USING btree ("user_id","account_id","occurred_on");--> statement-breakpoint
CREATE INDEX "ledger_transaction_category_date_idx" ON "ledger_transaction" USING btree ("user_id","category_id","occurred_on");--> statement-breakpoint
CREATE INDEX "ledger_transaction_transfer_group_idx" ON "ledger_transaction" USING btree ("transfer_group_id");