-- Git Providers: Dokploy-style multi-account & multi-organization support.
--
-- Each row represents a connected Git account/token for an organization.
-- Strict tenant isolation: organization_id is mandatory, tokens are encrypted at rest.
-- shared_with_org flag controls whether other org members can use this account to deploy.

CREATE TABLE IF NOT EXISTS "git_providers" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "provider_type" text DEFAULT 'github' NOT NULL,
  "github_login" text,
  "github_avatar_url" text,
  "token_encrypted" text NOT NULL,
  "token_method" text DEFAULT 'device' NOT NULL,
  "shared_with_org" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_git_providers_org_user_login" UNIQUE ("organization_id", "user_id", "github_login")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "git_providers_org_idx" ON "git_providers" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "git_providers_user_idx" ON "git_providers" ("user_id");
