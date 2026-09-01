-- Persist the exact GitHub account selected for a project/environment.
-- Nullable preserves local, upload, release and legacy projects.
ALTER TABLE "project_app" ADD COLUMN IF NOT EXISTS "git_provider_id" text;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "git_provider_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_app_git_provider_idx" ON "project_app" ("git_provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_git_provider_idx" ON "project" ("git_provider_id");
