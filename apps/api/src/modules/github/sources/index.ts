/**
 * GitHub source resolver — THE single place source selection happens.
 *
 * createGitHubSource(ctx) replaces the scattered
 * resolveGitHubAuthMode → getUserStatus → resolveListingSource → tokenFor
 * re-derivation. Callers (the controllers) just hand off to the resolved source.
 *
 *   - CLOUD_MODE (the SaaS): GitHubAppSource directly — App service ONLY, no
 *     gh, no merge. CLOUD_MODE needs NO cloud probe (the mode is "app").
 *   - local: LocalGitHubSource (the merge). gh-FIRST — built from a LOCAL gh
 *     token read with NO cloud round-trip. The App sub-source (and the cloud
 *     mode-probe it needs) is resolved LAZILY inside the merge, only when a
 *     clone token / connection-status is requested. So a plain library listing
 *     stays 100% local — zero cloud.
 *
 * gh-cli-source / local-source / app-source are loaded via `await import` so
 * the gh code path never enters the SaaS process.
 */

import { env } from "../../../config/env";
import type { RequestContext } from "../../../lib/request-context";
import type { GitHubSource } from "./types";

export async function createGitHubSource(
  ctx: RequestContext,
  providerId?: string,
): Promise<GitHubSource> {
  providerId = providerId ?? ctx.gitProviderId;
  // SaaS: the App service only. Zero gh, no merge, no cloud mode-probe.
  if (env.CLOUD_MODE) {
    const { GitHubAppSource } = await import("./app-source");
    return new GitHubAppSource(ctx, "app");
  }

  // 1. Dokploy-style: Check if there's a git-provider for this organization & user
  if (ctx.organizationId) {
    const { GitProviderSource } = await import("./git-provider-source");
    const providerSource = new GitProviderSource(ctx, providerId);
    if (await providerSource.hasProvider()) {
      const { LocalGitHubSource } = await import("./local-source");
      return new LocalGitHubSource(ctx, providerSource);
    }
  }

  // 2. Local: gh-FIRST (operator fallback if no git-provider configured for this org)
  // CRITICAL: Prevent operator token leak to other organizations/members.
  const { mayUseOperatorCliToken } = await import("../github.token");
  const canBorrow = await mayUseOperatorCliToken(ctx.userId, ctx.organizationId, "local");
  const { GhCliSource } = await import("./gh-cli-source");
  const gh = canBorrow ? new GhCliSource(ctx.userId) : null;
  const { LocalGitHubSource } = await import("./local-source");
  return new LocalGitHubSource(ctx, (gh && await gh.token()) ? gh : null);
}
