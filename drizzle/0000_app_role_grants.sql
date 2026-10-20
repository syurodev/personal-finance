-- Custom SQL migration file, put your code below! --
GRANT USAGE ON SCHEMA public TO pf_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE pf_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pf_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE pf_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pf_app;
