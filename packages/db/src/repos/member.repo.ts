/**
 * Member repo — reads on the `member` join table managed by the Better
 * Auth organization plugin.
 *
 * The plugin owns the WRITE path (createOrganization, inviteMember,
 * acceptInvitation, updateMemberRole, removeMember, leaveOrganization)
 * through Better Auth's own DB adapter. We READ here from outside the
 * plugin — for active-org resolution, role gating, and the Members UI.
 */

import { and, asc, eq } from "drizzle-orm";
import type { db as Db } from "../client";
import { member } from "../schema/organization";
import { user } from "../schema/auth";

export type Member = typeof member.$inferSelect;
export type MemberRole = "owner" | "admin" | "member";

export function createMemberRepo(db: typeof Db) {
  return {
    /** All memberships for a user, oldest first. */
    async listByUser(userId: string): Promise<Member[]> {
      return db
        .select()
        .from(member)
        .where(eq(member.userId, userId))
        .orderBy(asc(member.createdAt));
    },

    /** All members of an organization, with their user record joined. */
    async listByOrganization(organizationId: string) {
      return db
        .select({
          id: member.id,
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          },
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, organizationId))
        .orderBy(asc(member.createdAt));
    },

    /** Look up a specific (org, user) membership. */
    async find(organizationId: string, userId: string): Promise<Member | null> {
      const rows = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },

    /** Does this user belong to this org? */
    async isMember(organizationId: string, userId: string): Promise<boolean> {
      return !!(await this.find(organizationId, userId));
    },

    /** Store (or clear) a per-user-per-org GitHub token. */
    async setGithubToken(
      organizationId: string,
      userId: string,
      encrypted: string | null,
      setAt: Date | null,
      method: string | null,
    ): Promise<void> {
      await db
        .update(member)
        .set({
          githubTokenEncrypted: encrypted,
          githubTokenSetAt: setAt,
          githubTokenMethod: method as "device" | "token" | null,
        })
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
    },

    /** Update cached GitHub profile info for a member. */
    async setGithubProfile(
      organizationId: string,
      userId: string,
      login: string | null,
      avatarUrl: string | null,
    ): Promise<void> {
      await db
        .update(member)
        .set({
          githubLogin: login,
          githubAvatarUrl: avatarUrl,
        })
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
    },

    /** List all members of an organization with their GitHub connection info. */
    async listByOrganizationWithGithub(organizationId: string) {
      return db
        .select({
          id: member.id,
          organizationId: member.organizationId,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          githubTokenSetAt: member.githubTokenSetAt,
          githubTokenMethod: member.githubTokenMethod,
          githubLogin: member.githubLogin,
          githubAvatarUrl: member.githubAvatarUrl,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          },
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, organizationId))
        .orderBy(asc(member.createdAt));
    },
  };
}
