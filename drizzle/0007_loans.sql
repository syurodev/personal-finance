CREATE TABLE "loan" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"direction" text NOT NULL,
	"total_payable" numeric NOT NULL,
	"currency" text NOT NULL,
	"term_months" integer NOT NULL,
	"start_date" date NOT NULL,
	"first_due_date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"payment_account_id" uuid,
	"disbursement_transaction_id" uuid,
	"cost_transaction_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_direction_check" CHECK ("loan"."direction" in ('borrow', 'lend')),
	CONSTRAINT "loan_status_check" CHECK ("loan"."status" in ('active', 'closed', 'cancelled')),
	CONSTRAINT "loan_total_positive" CHECK ("loan"."total_payable" > 0),
	CONSTRAINT "loan_term_range" CHECK ("loan"."term_months" between 1 and 600)
);
--> statement-breakpoint
CREATE TABLE "loan_installment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"loan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_due" numeric NOT NULL,
	"status" text DEFAULT 'due' NOT NULL,
	"paid_on" date,
	"amount_paid" numeric,
	"transfer_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_installment_status_check" CHECK ("loan_installment"."status" in ('due', 'paid')),
	CONSTRAINT "loan_installment_amount_positive" CHECK ("loan_installment"."amount_due" > 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_account" DROP CONSTRAINT "ledger_account_type_check";--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_account_id_ledger_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_payment_account_id_ledger_account_id_fk" FOREIGN KEY ("payment_account_id") REFERENCES "public"."ledger_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_disbursement_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("disbursement_transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_cost_transaction_id_ledger_transaction_id_fk" FOREIGN KEY ("cost_transaction_id") REFERENCES "public"."ledger_transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_installment" ADD CONSTRAINT "loan_installment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_installment" ADD CONSTRAINT "loan_installment_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loan_user_name_uidx" ON "loan" USING btree ("user_id",lower("name")) WHERE "loan"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "loan_installment_loan_seq_uidx" ON "loan_installment" USING btree ("loan_id","seq");--> statement-breakpoint
CREATE INDEX "loan_installment_user_due_idx" ON "loan_installment" USING btree ("user_id","status","due_date");--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_type_check" CHECK ("ledger_account"."type" in ('cash', 'bank', 'credit_card', 'ewallet', 'loan'));