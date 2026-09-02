import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organization } from "./organization";
import { servers } from "./servers";
import { project } from "./project";

// ─── Cloudflare Tunnels integration ──────────────────────────────────────────

/**
 * The connected Cloudflare account (one per organization in v1).
 *
 * `apiTokenCiphertext` is the write-only API token pasted in Settings —
 * encrypted with the same instance key as SSH/registry credentials and never
 * sent back to the browser. `zonesCache` mirrors the account's zones so the
 * domain picker works without hammering the Cloudflare API.
 */
export const cfAccounts = pgTable(
  "cf_accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    /** Cloudflare account id the token belongs to. */
    cfAccountId: text("cf_account_id").notNull(),
    /** Human label shown in Settings (account name from the API). */
    label: text("label").notNull(),

    apiTokenCiphertext: text("api_token_ciphertext").notNull(),

    /** [{ zoneId, name }] — refreshed lazily on connect / domain listing. */
    zonesCache: jsonb("zones_cache").notNull().default([]),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // One connection per Cloudflare account per org. Re-connecting upserts.
    uniqueIndex("uq_cf_accounts_org_account").on(
      table.organizationId,
      table.cfAccountId,
    ),
  ],
);

/**
 * One tunnel per node that needs exposure. `serverId` NULL = the OpenShip
 * control-plane box itself; otherwise the SSH server row whose docker runs the
 * cloudflared connector container.
 *
 * The connector token is fetched automatically from the Cloudflare API at
 * tunnel-creation time — users never handle it.
 */
export const cfTunnels = pgTable(
  "cf_tunnels",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    cfAccountRowId: text("cf_account_row_id")
      .notNull()
      .references(() => cfAccounts.id, { onDelete: "cascade" }),

    /** NULL = run cloudflared on the OpenShip box itself. */
    serverId: text("server_id").references(() => servers.id, {
      onDelete: "cascade",
    }),

    name: text("name").notNull(),

    /** Cloudflare's tunnel uuid — also the DNS target `<id>.cfargotunnel.com`. */
    cfTunnelId: text("cf_tunnel_id").notNull().unique(),
    connectorTokenCiphertext: text("connector_token_ciphertext").notNull(),

    status: text("status").notNull().default("stopped"), // stopped|running|error
    lastError: text("last_error"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_cf_tunnels_server").on(table.serverId),
    index("idx_cf_tunnels_org").on(table.organizationId),
  ],
);

/**
 * A public hostname published through a tunnel:
 * `hostname` → (Cloudflare edge) → cloudflared on the node → localhost:port.
 *
 * Ingress lives remote-managed on Cloudflare (PUT /cfd_tunnel/{id}/configurations);
 * this row mirrors our managed slice so the dashboard can render it and so
 * removal knows which DNS record to delete (`dnsRecordId`).
 */
export const cfTunnelRoutes = pgTable(
  "cf_tunnel_routes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    tunnelId: text("tunnel_id")
      .notNull()
      .references(() => cfTunnels.id, { onDelete: "cascade" }),

    /** Owning app, when attached from a project context. */
    projectId: text("project_id").references(() => project.id, {
      onDelete: "set null",
    }),

    hostname: text("hostname").notNull().unique(),
    targetPort: integer("target_port").notNull(),

    /**
     * 'app'  → cloudflared → localhost:<targetPort> (edge bypassed: no stats).
     * 'edge' → cloudflared → localhost:80, OpenResty routes by Host to the app
     *          via the linked domain row (externalIngress): full analytics,
     *          rate-limits and rules-engine. TLS stays at Cloudflare.
     */
    mode: text("mode").notNull().default("app"),

    /** For 'edge' routes: the OpenShip domain row this route created/drives. */
    domainId: text("domain_id"),

    zoneId: text("zone_id"),
    dnsRecordId: text("dns_record_id"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("idx_cf_tunnel_routes_tunnel").on(table.tunnelId)],
);
