ALTER TABLE "loan" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "loan" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "loan_owner" ON "loan" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
--> statement-breakpoint
ALTER TABLE "loan_installment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "loan_installment" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "loan_installment_owner" ON "loan_installment" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
