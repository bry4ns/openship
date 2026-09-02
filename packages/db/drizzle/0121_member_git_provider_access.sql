ALTER TABLE "member" ADD COLUMN IF NOT EXISTS "accessed_git_providers" jsonb NOT NULL DEFAULT '[]'::jsonb;
