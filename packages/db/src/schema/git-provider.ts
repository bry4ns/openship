import { pgTable, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organization";

/**
 * Git Providers (Dokploy-style multi-account & multi-organization support).
 *
 * Each row represents a connected Git account/token for an organization.
 * - Belonging strictly to an organization and the user who connected it.
 * - `sharedWithOrg`: if true, any member of the organization can deploy apps with this account.
 * - `providerType`: 'github' (future: 'gitlab', 'bitbucket', 'gitea')
 * - `tokenMethod`: 'device' (device flow via browser) | 'token' (pasted Personal Access Token)
 */
export const gitProviders = pgTable(
  "git_providers",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // User-facing label: e.g. "Personal", "Empresa", or "@username"
    providerType: text("provider_type").notNull().default("github"),
    githubLogin: text("github_login"),
    githubAvatarUrl: text("github_avatar_url"),
    tokenEncrypted: text("token_encrypted").notNull(),
    tokenMethod: text("token_method").notNull().default("device"), // 'device' | 'token'
    sharedWithOrg: boolean("shared_with_org").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("git_providers_org_idx").on(t.organizationId),
    index("git_providers_user_idx").on(t.userId),
    uniqueIndex("uq_git_providers_org_user_login").on(t.organizationId, t.userId, t.githubLogin),
  ],
);

export type GitProvider = typeof gitProviders.$inferSelect;
export type NewGitProvider = typeof gitProviders.$inferInsert;
