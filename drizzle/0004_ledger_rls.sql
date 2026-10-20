-- Custom SQL migration file, put your code below! --
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
ALTER TABLE "ledger_account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger_account" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ledger_account_owner" ON "ledger_account" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "category_owner" ON "category" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE "ledger_transaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger_transaction" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ledger_transaction_owner" ON "ledger_transaction" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
