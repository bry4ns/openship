/**
 * Cloudflare Tunnel route teardown shared by the domain-removal path and the
 * project-deletion pipeline.
 *
 * The publish path (cf.controller addRoute) writes three coupled pieces of state:
 *   - a `cf_tunnel_routes` row,
 *   - a Cloudflare DNS CNAME (→ `<tunnelId>.cfargotunnel.com`),
 *   - the tunnel's remote-managed ingress entry.
 * Removing the app's domain row alone leaves the DNS record + ingress live, so
 * the hostname keeps resolving into the tunnel even though nothing serves it.
 * These helpers unwind all three (plus the connector, when the last route goes),
 * best-effort: Cloudflare or the node being unreachable must never block a
 * domain removal or a project delete.
 */

import { and, eq } from "drizzle-orm";
import { db, schema } from "@repo/db";
import { deleteDnsRecord, putIngressConfig, type CfIngressRule } from "@repo/adapters";
import { decrypt } from "./encryption";
import { stopConnector } from "./cf-tunnel-manager";

type CfAccountRow = typeof schema.cfAccounts.$inferSelect;
type CfTunnelRow = typeof schema.cfTunnels.$inferSelect;
type CfRouteRow = typeof schema.cfTunnelRoutes.$inferSelect;

interface JoinedRoute {
  route: CfRouteRow;
  tunnel: CfTunnelRow;
  account: CfAccountRow;
}

async function routesOf(tunnelRowId: string): Promise<CfRouteRow[]> {
  return db
    .select()
    .from(schema.cfTunnelRoutes)
    .where(eq(schema.cfTunnelRoutes.tunnelId, tunnelRowId));
}

/** Rebuild the tunnel's remote-managed ingress from its remaining rows. */
async function syncTunnelIngress(
  account: CfAccountRow,
  tunnel: CfTunnelRow,
): Promise<void> {
  const token = decrypt(account.apiTokenCiphertext);
  const rows = await routesOf(tunnel.id);
  const ingress: CfIngressRule[] = rows.map((r) => ({
    hostname: r.hostname,
    service: r.mode === "edge" ? "http://localhost:80" : `http://localhost:${r.targetPort}`,
  }));
  ingress.push({ service: "http_status:404" });
  await putIngressConfig(token, account.cfAccountId, tunnel.cfTunnelId, ingress);
}

/** Org-scoped lookup of a route by hostname, joined to its tunnel + account. */
async function findJoinedByHostname(
  orgId: string,
  hostname: string,
): Promise<JoinedRoute | null> {
  const [row] = await db
    .select()
    .from(schema.cfTunnelRoutes)
    .innerJoin(schema.cfTunnels, eq(schema.cfTunnels.id, schema.cfTunnelRoutes.tunnelId))
    .innerJoin(schema.cfAccounts, eq(schema.cfAccounts.id, schema.cfTunnels.cfAccountRowId))
    .where(
      and(
        eq(schema.cfTunnelRoutes.hostname, hostname.trim().toLowerCase()),
        eq(schema.cfAccounts.organizationId, orgId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const { cf_tunnel_routes: route, cf_tunnels: tunnel, cf_accounts: account } = row;
  return { route, tunnel, account };
}

/** Org-scoped routes owned by a project, each joined to its tunnel + account. */
async function findJoinedByProject(projectId: string): Promise<JoinedRoute[]> {
  const rows = await db
    .select()
    .from(schema.cfTunnelRoutes)
    .innerJoin(schema.cfTunnels, eq(schema.cfTunnels.id, schema.cfTunnelRoutes.tunnelId))
    .innerJoin(schema.cfAccounts, eq(schema.cfAccounts.id, schema.cfTunnels.cfAccountRowId))
    .where(eq(schema.cfTunnelRoutes.projectId, projectId));
  return rows.map(({ cf_tunnel_routes: route, cf_tunnels: tunnel, cf_accounts: account }) => ({
    route,
    tunnel,
    account,
  }));
}

/**
 * Tear down ONE joined route: DNS record + row + ingress (connector stopped when
 * it was the last route). Best-effort — every Cloudflare/node failure is
 * swallowed so callers never regress on an unreachable edge. Idempotent.
 */
async function detachJoinedRoute(joined: JoinedRoute): Promise<void> {
  const { route, tunnel, account } = joined;
  const apiToken = decrypt(account.apiTokenCiphertext);
  if (route.dnsRecordId && route.zoneId) {
    await deleteDnsRecord(apiToken, route.zoneId, route.dnsRecordId).catch(() => {});
  }
  await db.delete(schema.cfTunnelRoutes).where(eq(schema.cfTunnelRoutes.id, route.id));

  // Rebuild ingress without the removed route; when empty only the catch-all
  // remains (nothing published).
  await syncTunnelIngress(account, tunnel).catch(() => {});

  const remaining = await routesOf(tunnel.id);
  if (remaining.length === 0) {
    // Nothing published anymore — stop burning resources on the node.
    await stopConnector(tunnel.serverId, tunnel.id).catch(() => {});
    await db
      .update(schema.cfTunnels)
      .set({ status: "stopped" })
      .where(eq(schema.cfTunnels.id, tunnel.id))
      .catch(() => {});
  }
}

/**
 * Tear down the route for a hostname, org-scoped. Best-effort + non-throwing so
 * the domain-removal path (removeLiveDomain) never regresses on an unreachable
 * Cloudflare/node. No-op when the hostname isn't tunnel-published.
 */
export async function detachCfRouteByHostname(
  orgId: string,
  hostname: string,
): Promise<void> {
  const joined = await findJoinedByHostname(orgId, hostname);
  if (!joined) return;
  await detachJoinedRoute(joined).catch(() => {});
}

/**
 * Tear down every tunnel route owned by a project (project-deletion pipeline).
 * Best-effort per route; a failed route never blocks the others or the delete.
 * Returns the number of routes detached (for teardown reporting).
 */
export async function detachCfRoutesByProject(projectId: string): Promise<number> {
  const joined = await findJoinedByProject(projectId);
  await Promise.allSettled(joined.map((j) => detachJoinedRoute(j)));
  return joined.length;
}