import { eq, and, or, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { Database } from "../client";
import { gitProviders } from "../schema";

export type GitProvider = typeof gitProviders.$inferSelect;
export type NewGitProvider = typeof gitProviders.$inferInsert;

export interface CreateGitProviderInput {
  id?: string;
  organizationId: string;
  userId: string;
  name: string;
  providerType?: string;
  githubLogin?: string | null;
  githubAvatarUrl?: string | null;
  tokenEncrypted: string;
  tokenMethod?: string;
  sharedWithOrg?: boolean;
}

export function createGitProviderRepo(db: Database) {
  return {
    /** Find a git provider by its ID */
    async findById(id: string) {
      return db.query.gitProviders.findFirst({
        where: eq(gitProviders.id, id),
      });
    },

    /** Find a git provider by ID and ensure it belongs to the organization */
    async findInOrg(id: string, organizationId: string) {
      return db.query.gitProviders.findFirst({
        where: and(
          eq(gitProviders.id, id),
          eq(gitProviders.organizationId, organizationId),
        ),
      });
    },

    /**
     * Find a provider that the user has permission to use:
     * Either the user created it, or it is marked as shared with the organization.
     */
    async findAccessible(id: string, organizationId: string, userId: string) {
      return db.query.gitProviders.findFirst({
        where: and(
          eq(gitProviders.id, id),
          eq(gitProviders.organizationId, organizationId),
          or(
            eq(gitProviders.userId, userId),
            eq(gitProviders.sharedWithOrg, true),
          ),
        ),
      });
    },

    /**
     * List all providers accessible to a user in an organization:
     * - The user's own connected accounts.
     * - Accounts shared with the organization by other members.
     */
    async listForUser(organizationId: string, userId: string) {
      return db.query.gitProviders.findMany({
        where: and(
          eq(gitProviders.organizationId, organizationId),
          or(
            eq(gitProviders.userId, userId),
            eq(gitProviders.sharedWithOrg, true),
          ),
        ),
        orderBy: [desc(gitProviders.createdAt)],
      });
    },

    /** List all providers in an organization (for org owners/admins) */
    async listAllInOrg(organizationId: string) {
      return db.query.gitProviders.findMany({
        where: eq(gitProviders.organizationId, organizationId),
        orderBy: [desc(gitProviders.createdAt)],
      });
    },

    /**
     * Upsert a Git provider. If the same user in the same org reconnects
     * the same github_login, update the token, name, and profile in place.
     */
    async upsert(input: CreateGitProviderInput): Promise<GitProvider> {
      const id = input.id ?? randomUUID();
      const rows = await db
        .insert(gitProviders)
        .values({
          id,
          organizationId: input.organizationId,
          userId: input.userId,
          name: input.name,
          providerType: input.providerType ?? "github",
          githubLogin: input.githubLogin ?? null,
          githubAvatarUrl: input.githubAvatarUrl ?? null,
          tokenEncrypted: input.tokenEncrypted,
          tokenMethod: input.tokenMethod ?? "device",
          sharedWithOrg: input.sharedWithOrg ?? false,
        })
        .onConflictDoUpdate({
          target: [gitProviders.organizationId, gitProviders.userId, gitProviders.githubLogin],
          set: {
            name: input.name,
            githubAvatarUrl: input.githubAvatarUrl ?? null,
            tokenEncrypted: input.tokenEncrypted,
            tokenMethod: input.tokenMethod ?? "device",
            updatedAt: new Date(),
          },
        })
        .returning();

      return rows[0];
    },

    /** Toggle the sharedWithOrg state (only the owner of the token can toggle) */
    async setShared(id: string, organizationId: string, userId: string, sharedWithOrg: boolean) {
      const rows = await db
        .update(gitProviders)
        .set({
          sharedWithOrg,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(gitProviders.id, id),
            eq(gitProviders.organizationId, organizationId),
            eq(gitProviders.userId, userId),
          ),
        )
        .returning();

      return rows[0] ?? null;
    },

    /** Delete a provider (owner of the provider or org admin) */
    async delete(id: string, organizationId: string, userId?: string) {
      const whereClause = userId
        ? and(
            eq(gitProviders.id, id),
            eq(gitProviders.organizationId, organizationId),
            eq(gitProviders.userId, userId),
          )
        : and(
            eq(gitProviders.id, id),
            eq(gitProviders.organizationId, organizationId),
          );

      const rows = await db.delete(gitProviders).where(whereClause).returning();
      return rows[0] ?? null;
    },
  };
}
