/**
 * GitProviderSource — Dokploy-style per-org/per-user Git Provider.
 *
 * Implements the sub-source interface expected by LocalGitHubSource.
 * Resolves credentials strictly scoped to the RequestContext's organizationId
 * and userId from the `git_providers` table.
 */

import { repos } from "@repo/db";
import { decrypt } from "../../../lib/encryption";
import { ghFetchSoft } from "../github.http";
import { mapRepositories } from "./mappers";
import type { RequestContext } from "../../../lib/request-context";
import type { GhCliStatus } from "./gh-cli-source";
import type {
  GitHubRepository,
  MappedAccount,
  MappedRepository,
} from "../github.types";
import type { GitProvider } from "@repo/db";

export class GitProviderSource {
  private resolvedProvider: GitProvider | null | undefined = undefined;

  constructor(
    private readonly ctx: RequestContext,
    private readonly providerId?: string,
  ) {}

  /** Resolve the active git provider row for this context */
  async getProvider(): Promise<GitProvider | null> {
    if (this.resolvedProvider !== undefined) return this.resolvedProvider;
    if (!this.ctx.organizationId) {
      this.resolvedProvider = null;
      return null;
    }

    // 1. If explicit providerId specified, fetch it (ensuring access)
    if (this.providerId) {
      const p = await repos.gitProvider.findAccessible(
        this.providerId,
        this.ctx.organizationId,
        this.ctx.userId || "",
      );
      this.resolvedProvider = p ?? null;
      return this.resolvedProvider;
    }

    // 2. Otherwise find accessible providers for the user in this org
    if (this.ctx.userId) {
      const list = await repos.gitProvider.listForUser(
        this.ctx.organizationId,
        this.ctx.userId,
      );
      // Own provider takes precedence
      const own = list.find((p) => p.userId === this.ctx.userId);
      if (own) {
        this.resolvedProvider = own;
        return this.resolvedProvider;
      }
      // Shared provider fallback
      const shared = list.find((p) => p.sharedWithOrg);
      if (shared) {
        this.resolvedProvider = shared;
        return this.resolvedProvider;
      }
    }

    this.resolvedProvider = null;
    return null;
  }

  /** Check if a valid git provider is configured for this context */
  async hasProvider(): Promise<boolean> {
    const p = await this.getProvider();
    return Boolean(p && p.tokenEncrypted);
  }

  /** Decrypted token string or null */
  async token(): Promise<string | null> {
    const p = await this.getProvider();
    if (!p?.tokenEncrypted) return null;
    try {
      return decrypt(p.tokenEncrypted);
    } catch {
      return null;
    }
  }

  /** Status shape matching GhCliStatus for UI compatibility */
  async status(): Promise<GhCliStatus> {
    const p = await this.getProvider();
    const checkedAt = new Date().toISOString();
    if (!p) {
      return { available: false, method: null, checkedAt };
    }

    const t = await this.token();
    if (!t) {
      return { available: false, method: "device", problem: "rejected", checkedAt };
    }

    return {
      available: true,
      login: p.githubLogin || p.name,
      id: 0,
      avatar_url: p.githubAvatarUrl || "",
      method: p.tokenMethod === "token" ? "token" : "device",
      checkedAt: p.updatedAt ? p.updatedAt.toISOString() : checkedAt,
    };
  }

  /** Fetch every repo visible to this provider's token */
  async listAllRepos(): Promise<MappedRepository[]> {
    const t = await this.token();
    if (!t) return [];

    const raw = await ghFetchSoft<unknown[]>(t, {
      url:
        "https://api.github.com/user/repos" +
        "?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    });
    return mapRepositories(Array.isArray(raw) ? (raw as GitHubRepository[]) : []);
  }

  /** Filter repos for a specific owner */
  async listReposForOwner(owner?: string): Promise<MappedRepository[]> {
    const all = await this.listAllRepos();
    if (!owner) return all;
    const target = owner.toLowerCase();
    return all.filter(
      (r) => (r.full_name.split("/")[0] ?? "").toLowerCase() === target,
    );
  }

  /** Return the provider user + all organization memberships */
  async listOwners(): Promise<MappedAccount[]> {
    const p = await this.getProvider();
    const t = await this.token();
    if (!p || !t) return [];

    const out: MappedAccount[] = [];
    const seen = new Set<string>();

    if (p.githubLogin) {
      out.push({
        login: p.githubLogin,
        id: 0,
        avatar_url: p.githubAvatarUrl || "",
        type: "User",
        source: "cli",
      });
      seen.add(p.githubLogin.toLowerCase());
    }

    const orgs =
      (await ghFetchSoft<Array<{ login: string; id: number; avatar_url: string }>>(t, {
        url: "https://api.github.com/user/orgs?per_page=100",
      })) ?? [];

    for (const org of orgs) {
      if (seen.has(org.login.toLowerCase())) continue;
      out.push({
        login: org.login,
        id: org.id,
        avatar_url: org.avatar_url,
        type: "Organization",
        source: "cli",
      });
      seen.add(org.login.toLowerCase());
    }

    return out;
  }
}
