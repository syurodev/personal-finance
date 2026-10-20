ALTER TABLE "budget" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budget" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "budget_owner" ON "budget" TO pf_app
  USING ("user_id" = current_setting('app.user_id', true))
  WITH CHECK ("user_id" = current_setting('app.user_id', true));
