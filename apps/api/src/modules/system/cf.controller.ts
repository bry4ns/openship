/**
 * Cloudflare Tunnels controller — connect account, per-node tunnels, routes.
 *
 * Mounted under /api/system (self-hosted). All rows are organization-scoped;
 * every handler re-checks ownership so cross-org ids 404 like missing.
 *
 * Secrets: the Cloudflare API token and tunnel connector tokens are stored
 * encrypted (encrypt()/decrypt() with the instance key) and never returned to
 * the browser — only derived state (label, zones, status) is.
 */

import type { Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db, repos, schema } from "@repo/db";
import { getRequestContext } from "../../lib/request-context";
import { assertNotCloud } from "../../lib/controller-helpers";
import { encrypt, decrypt } from "../../lib/encryption";
import {
  verifyApiToken,
  listAccounts,
  listZones,
  listZonesWithAccount,
  createTunnel,
  cfDeleteTunnel,
  getConnectorToken,
  putIngressConfig,
  createTunnelDnsRecord,
  deleteDnsRecord,
  type CfIngressRule,
  type CfZone,
} from "@repo/adapters";
import {
  ensureConnectorRunning,
  stopConnector,
  connectorStatus,
  connectorLogs,
} from "../../lib/cf-tunnel-manager";

type CfAccountRow = typeof schema.cfAccounts.$inferSelect;
type CfTunnelRow = typeof schema.cfTunnels.$inferSelect;

function fail(c: Context, message: string, status = 400) {
  return c.json({ error: message }, status);
}

/** The org-scoped connected account, or null. */
async function getAccount(orgId: string): Promise<CfAccountRow | null> {
  const [row] = await db
    .select()
    .from(schema.cfAccounts)
    .where(eq(schema.cfAccounts.organizationId, orgId))
    .limit(1);
  return row ?? null;
}

function decryptedZones(row: CfAccountRow): CfZone[] {
  return Array.isArray(row.zonesCache) ? (row.zonesCache as CfZone[]) : [];
}

/** Org-scoped tunnel by id, or null. */
async function getTunnel(orgId: string, id: string): Promise<CfTunnelRow | null> {
  const [row] = await db
    .select()
    .from(schema.cfTunnels)
    .where(and(eq(schema.cfTunnels.id, id), eq(schema.cfTunnels.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

async function routesOf(tunnelRowId: string) {
  return db
    .select()
    .from(schema.cfTunnelRoutes)
    .where(eq(schema.cfTunnelRoutes.tunnelId, tunnelRowId))
    .orderBy(schema.cfTunnelRoutes.createdAt);
}

/**
 * Push the full remote-managed ingress list for a tunnel from its DB rows.
 * Always ends with the required catch-all rule.
 */
async function syncIngress(account: CfAccountRow, tunnel: CfTunnelRow): Promise<void> {
  const token = decrypt(account.apiTokenCiphertext);
  const rows = await routesOf(tunnel.id);
  const ingress: CfIngressRule[] = rows.map((r) => ({
    hostname: r.hostname,
    service: `http://localhost:${r.targetPort}`,
  }));
  ingress.push({ service: "http_status:404" });
  await putIngressConfig(token, account.cfAccountId, tunnel.cfTunnelId, ingress);
}

function nodeLabel(serverId: string | null, serverName?: string | null): string {
  if (!serverId) return "This box (OpenShip)";
  return serverName ?? `server ${serverId.slice(0, 8)}`;
}

// ─── Integration connect / disconnect ────────────────────────────────────────

export async function getIntegration(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);

  const account = await getAccount(ctx.organizationId);
  if (!account) return c.json({ connected: false });

  const tunnels = await db
    .select({
      id: schema.cfTunnels.id,
      name: schema.cfTunnels.name,
      serverId: schema.cfTunnels.serverId,
      status: schema.cfTunnels.status,
      lastError: schema.cfTunnels.lastError,
      serverName: schema.servers.name,
    })
    .from(schema.cfTunnels)
    .leftJoin(schema.servers, eq(schema.servers.id, schema.cfTunnels.serverId))
    .where(eq(schema.cfTunnels.organizationId, ctx.organizationId));

  const withCounts = await Promise.all(
    tunnels.map(async (t) => ({
      ...t,
      node: nodeLabel(t.serverId, t.serverName),
      routeCount:
        (
          await db
            .select({ id: schema.cfTunnelRoutes.id })
            .from(schema.cfTunnelRoutes)
            .where(eq(schema.cfTunnelRoutes.tunnelId, t.id))
        ).length,
    })),
  );

  return c.json({
    connected: true,
    label: account.label,
    zones: decryptedZones(account),
    tunnels: withCounts,
  });
}

/** PUT { apiToken } — verify against Cloudflare, cache account + zones. */
export async function connectIntegration(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);

  const body = (await c.req.json().catch(() => ({}))) as { apiToken?: unknown };
  const apiToken = typeof body.apiToken === "string" ? body.apiToken.trim() : "";
  if (!apiToken) return fail(c, "apiToken is required");

  // Validate before persisting anything.
  await verifyApiToken(apiToken);

  // Resolve the Cloudflare account. Tokens usually scope Zone:Read per-zone
  // while omitting account-level read — /accounts then returns EMPTY even
  // though tunnels/DNS work fine. Fall back to deriving the account from the
  // zones themselves before rejecting.
  let accountId = "";
  let label = "Cloudflare";
  let zones: CfZone[] = [];
  const accounts = await listAccounts(apiToken).catch(() => []);
  if (accounts.length > 0) {
    accountId = accounts[0].id;
    label = accounts[0].name;
    try {
      zones = await listZones(apiToken, accountId);
    } catch {
      zones = []; // token without Zone:Read still works for tunnels; domain picker degrades
    }
  } else {
    const zoned = await listZonesWithAccount(apiToken);
    if (zoned.length === 0) {
      return fail(
        c,
        "This token is valid but has no account or zone access. Add Account:Cloudflare Tunnel:Edit + Zone:DNS:Edit (+ Zone:Zone:Read) to its permissions.",
        403,
      );
    }
    accountId = zoned[0]!.accountId;
    label = zoned[0]!.accountName;
    zones = zoned.map(({ zoneId, name }) => ({ zoneId, name }));
  }

  const existing = await db
    .select()
    .from(schema.cfAccounts)
    .where(
      and(
        eq(schema.cfAccounts.organizationId, ctx.organizationId),
        eq(schema.cfAccounts.cfAccountId, accountId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.cfAccounts)
      .set({
        apiTokenCiphertext: encrypt(apiToken),
        label,
        zonesCache: zones,
      })
      .where(eq(schema.cfAccounts.id, existing[0].id));
    return c.json({ ok: true, label, zones });
  }

  const anyAccount = await getAccount(ctx.organizationId);
  if (anyAccount) {
    return fail(
      c,
      `Already connected to a different Cloudflare account (${anyAccount.label}). Disconnect first.`,
      409,
    );
  }

  await db.insert(schema.cfAccounts).values({
    id: crypto.randomUUID(),
    organizationId: ctx.organizationId,
    cfAccountId: accountId,
    label,
    apiTokenCiphertext: encrypt(apiToken),
    zonesCache: zones,
  });
  return c.json({ ok: true, label, zones });
}

/** Disconnect: stop connectors (best effort), then cascade-delete everything. */
export async function disconnectIntegration(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);

  const tunnels = await db
    .select()
    .from(schema.cfTunnels)
    .where(eq(schema.cfTunnels.organizationId, ctx.organizationId));

  await Promise.allSettled(
    tunnels.map((t) =>
      stopConnector(t.serverId, t.id).catch(() => {}),
    ),
  );
  await db.delete(schema.cfAccounts).where(eq(schema.cfAccounts.organizationId, ctx.organizationId));
  return c.json({ ok: true });
}

// ─── Tunnels ─────────────────────────────────────────────────────────────────

/**
 * POST { serverId?: string|null } — resolve-or-create this org's tunnel for a
 * node, then make sure its connector container is running there.
 */
export async function ensureTunnel(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);

  const body = (await c.req.json().catch(() => ({}))) as { serverId?: unknown };
  const serverId =
    typeof body.serverId === "string" && body.serverId ? body.serverId : null;

  if (serverId) {
    const server = await repos.server.getInOrganization(serverId, ctx.organizationId);
    if (!server) return fail(c, "Server not found", 404);
  }

  const account = await getAccount(ctx.organizationId);
  if (!account) return fail(c, "Connect a Cloudflare account first", 409);
  const apiToken = decrypt(account.apiTokenCiphertext);

  // Resolve-or-create the tunnel ROW for this node.
  // Resolve-or-create this org's tunnel row for the node.
  const byOrg = and(
    eq(schema.cfTunnels.organizationId, ctx.organizationId),
    eq(schema.cfTunnels.cfAccountRowId, account.id),
  );
  let tunnel: CfTunnelRow | undefined = (
    await db
      .select()
      .from(schema.cfTunnels)
      .where(
        serverId
          ? and(byOrg, eq(schema.cfTunnels.serverId, serverId))
          : and(byOrg, isNull(schema.cfTunnels.serverId)),
      )
      .limit(1)
  )[0];
  if (!tunnel) {
    let nodeName = "local";
    if (serverId) {
      const s = await repos.server.getInOrganization(serverId, ctx.organizationId);
      nodeName = (s?.name ?? "remote").replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 30);
    }
    const created = await createTunnel(apiToken, account.cfAccountId, `openship-${nodeName}`);
    const connectorToken = await getConnectorToken(apiToken, account.cfAccountId, created.id);
    const inserted = await db
      .insert(schema.cfTunnels)
      .values({
        id: crypto.randomUUID(),
        organizationId: ctx.organizationId,
        cfAccountRowId: account.id,
        serverId,
        name: created.name,
        cfTunnelId: created.id,
        connectorTokenCiphertext: encrypt(connectorToken),
        status: "stopped",
      })
      .returning();
    tunnel = inserted[0]!;
  }

  // Start the connector container on the node.
  try {
    await ensureConnectorRunning(tunnel.serverId, tunnel.id, decrypt(tunnel.connectorTokenCiphertext));
    await db
      .update(schema.cfTunnels)
      .set({ status: "running", lastError: null })
      .where(eq(schema.cfTunnels.id, tunnel.id));
    tunnel.status = "running";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.cfTunnels)
      .set({ status: "error", lastError: msg })
      .where(eq(schema.cfTunnels.id, tunnel.id));
    return fail(c, msg, 502);
  }

  return c.json({ ok: true, tunnel: { ...tunnel, connectorTokenCiphertext: undefined } });
}

export async function startTunnel(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);
  const tunnel = await getTunnel(ctx.organizationId, c.req.param("id")!);
  if (!tunnel) return fail(c, "Tunnel not found", 404);
  try {
    await ensureConnectorRunning(tunnel.serverId, tunnel.id, decrypt(tunnel.connectorTokenCiphertext));
    await db.update(schema.cfTunnels).set({ status: "running", lastError: null }).where(eq(schema.cfTunnels.id, tunnel.id));
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err instanceof Error ? err.message : String(err), 502);
  }
}

export async function stopTunnel(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);
  const tunnel = await getTunnel(ctx.organizationId, c.req.param("id")!);
  if (!tunnel) return fail(c, "Tunnel not found", 404);
  try {
    await stopConnector(tunnel.serverId, tunnel.id);
    await db.update(schema.cfTunnels).set({ status: "stopped" }).where(eq(schema.cfTunnels.id, tunnel.id));
    return c.json({ ok: true });
  } catch (err) {
    return fail(c, err instanceof Error ? err.message : String(err), 502);
  }
}

export async function tunnelStatus(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);
  const tunnel = await getTunnel(ctx.organizationId, c.req.param("id")!);
  if (!tunnel) return fail(c, "Tunnel not found", 404);
  try {
    const container = await connectorStatus(tunnel.serverId, tunnel.id);
    const routes = await routesOf(tunnel.id);
    return c.json({
      container,
      dbStatus: tunnel.status,
      lastError: tunnel.lastError,
      routes: routes.map((r) => ({
        id: r.id,
        hostname: r.hostname,
        targetPort: r.targetPort,
        projectId: r.projectId,
      })),
    });
  } catch (err) {
    return fail(c, err instanceof Error ? err.message : String(err), 502);
  }
}

export async function tunnelLogs(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);
  const tunnel = await getTunnel(ctx.organizationId, c.req.param("id")!);
  if (!tunnel) return fail(c, "Tunnel not found", 404);
  try {
    return c.json({ logs: await connectorLogs(tunnel.serverId, tunnel.id) });
  } catch (err) {
    return fail(c, err instanceof Error ? err.message : String(err), 502);
  }
}

/** DELETE — stop the connector, delete the CF tunnel + DNS is left to CF (routes die with it). */
export async function deleteTunnelHandler(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);
  const tunnel = await getTunnel(ctx.organizationId, c.req.param("id")!);
  if (!tunnel) return fail(c, "Tunnel not found", 404);
  const account = await getAccount(ctx.organizationId);
  try {
    await stopConnector(tunnel.serverId, tunnel.id);
  } catch {
    /* best effort */
  }
  if (account) {
    try {
      await cfDeleteTunnel(decrypt(account.apiTokenCiphertext), account.cfAccountId, tunnel.cfTunnelId);
    } catch {
      /* already gone on CF's side is fine */
    }
  }
  await db.delete(schema.cfTunnels).where(eq(schema.cfTunnels.id, tunnel.id));
  return c.json({ ok: true });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z]{2,63}$/;

/** POST { hostname, targetPort, zoneId?, projectId? } — publish one hostname. */
export async function addRoute(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);

  const tunnel = await getTunnel(ctx.organizationId, c.req.param("id")!);
  if (!tunnel) return fail(c, "Tunnel not found", 404);
  const account = await getAccount(ctx.organizationId);
  if (!account) return fail(c, "Connect a Cloudflare account first", 409);

  const body = (await c.req.json().catch(() => ({}))) as {
    hostname?: unknown;
    targetPort?: unknown;
    zoneId?: unknown;
    projectId?: unknown;
  };
  const hostname = typeof body.hostname === "string" ? body.hostname.trim().toLowerCase() : "";
  const targetPort = Number(body.targetPort);
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  const providedZoneId = typeof body.zoneId === "string" && body.zoneId ? body.zoneId : null;

  if (!HOSTNAME_RE.test(hostname)) return fail(c, "Invalid hostname");
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    return fail(c, "targetPort must be an integer between 1 and 65535");
  }

  const zones = decryptedZones(account);
  const zone =
    zones.find((z) => hostname === z.name) ??
    zones
      .filter((z) => hostname.endsWith(`.${z.name}`))
      .sort((a, b) => b.name.length - a.name.length)[0];
  const zoneId = providedZoneId ?? zone?.zoneId;
  if (!zoneId || !zone) {
    return fail(c, "Hostname is not under any of your connected Cloudflare zones");
  }

  const apiToken = decrypt(account.apiTokenCiphertext);
  const existingRoutes = await routesOf(tunnel.id);
  if (existingRoutes.some((r) => r.hostname === hostname)) {
    return fail(c, "Hostname already published through this tunnel", 409);
  }

  // DNS first (fails fast on permission problems, nothing persisted yet).
  let dnsRecordId: string | null = null;
  try {
    const dns = await createTunnelDnsRecord(apiToken, zoneId, hostname, tunnel.cfTunnelId);
    dnsRecordId = dns.id;
  } catch (err) {
    return fail(c, `DNS record failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  const inserted = await db
    .insert(schema.cfTunnelRoutes)
    .values({
      id: crypto.randomUUID(),
      tunnelId: tunnel.id,
      projectId,
      hostname,
      targetPort,
      zoneId,
      dnsRecordId,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted[0]) {
    // Lost a race on the unique hostname — roll the DNS record back.
    await deleteDnsRecord(apiToken, zoneId, dnsRecordId!).catch(() => {});
    return fail(c, "Hostname already published", 409);
  }

  try {
    await syncIngress(account, tunnel);
  } catch (err) {
    // Roll back fully — the route must not exist half-published.
    await db.delete(schema.cfTunnelRoutes).where(eq(schema.cfTunnelRoutes.id, inserted[0].id));
    await deleteDnsRecord(apiToken, zoneId, dnsRecordId!).catch(() => {});
    return fail(c, `Ingress update failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  return c.json({ ok: true, route: inserted[0] }, 201);
}

/** DELETE …/routes/:rid — remove ingress entry + DNS record + row. */
export async function removeRoute(c: Context) {
  const cloudGuard = assertNotCloud(c);
  if (cloudGuard) return cloudGuard;
  const ctx = getRequestContext(c);

  const tunnel = await getTunnel(ctx.organizationId, c.req.param("id")!);
  if (!tunnel) return fail(c, "Tunnel not found", 404);
  const rid = c.req.param("rid")!;

  const routes = await routesOf(tunnel.id);
  const route = routes.find((r) => r.id === rid);
  if (!route) return fail(c, "Route not found", 404);

  const account = await getAccount(ctx.organizationId);
  if (account) {
    const apiToken = decrypt(account.apiTokenCiphertext);
    if (route.dnsRecordId && route.zoneId) {
      await deleteDnsRecord(apiToken, route.zoneId, route.dnsRecordId).catch(() => {});
    }
    await db.delete(schema.cfTunnelRoutes).where(eq(schema.cfTunnelRoutes.id, route.id));
    try {
      // Rebuild without the removed route; when empty this leaves only the
      // catch-all (nothing published).
      await syncIngress(account, tunnel);
    } catch {
      /* DNS+row already cleaned; ingress drift is visible in Settings */
    }
    const remaining = await routesOf(tunnel.id);
    if (remaining.length === 0) {
      // Nothing published anymore — stop burning resources on the node.
      await stopConnector(tunnel.serverId, tunnel.id).catch(() => {});
      await db
        .update(schema.cfTunnels)
        .set({ status: "stopped" })
        .where(eq(schema.cfTunnels.id, tunnel.id));
    }
  } else {
    await db.delete(schema.cfTunnelRoutes).where(eq(schema.cfTunnelRoutes.id, route.id));
  }
  return c.json({ ok: true });
}
