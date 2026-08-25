-- Cloudflare Tunnels integration (fork feature branch).
--
-- Three tables: the connected Cloudflare account (API token), one tunnel per
-- node that needs exposure, and the hostname→port routes published through it.
-- Tokens are stored encrypted (same encrypt()/decrypt() as SSH/registry
-- credentials) and are never returned to the browser after save.
--
-- cf_tunnels.server_id NULL means the OpenShip box itself; otherwise the SSH
-- server row the cloudflared container runs on. Ingress configuration lives on
-- Cloudflare's side (remote-managed, PUT /cfd_tunnel/{id}/configurations);
-- these tables mirror what we manage so the dashboard can render and diff it.

CREATE TABLE IF NOT EXISTS "cf_accounts" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "cf_account_id" text NOT NULL,
  "label" text NOT NULL,
  "api_token_ciphertext" text NOT NULL,
  "zones_cache" jsonb DEFAULT '[]' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_cf_accounts_org_account" UNIQUE ("organization_id", "cf_account_id")
);

CREATE TABLE IF NOT EXISTS "cf_tunnels" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "cf_account_row_id" text NOT NULL REFERENCES "cf_accounts"("id") ON DELETE CASCADE,
  -- NULL = the OpenShip control-plane box itself.
  "server_id" text REFERENCES "servers"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "cf_tunnel_id" text NOT NULL UNIQUE,
  "connector_token_ciphertext" text NOT NULL,
  "status" text DEFAULT 'stopped' NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_cf_tunnels_server" ON "cf_tunnels" ("server_id");
CREATE INDEX IF NOT EXISTS "idx_cf_tunnels_org" ON "cf_tunnels" ("organization_id");

CREATE TABLE IF NOT EXISTS "cf_tunnel_routes" (
  "id" text PRIMARY KEY,
  "tunnel_id" text NOT NULL REFERENCES "cf_tunnels"("id") ON DELETE CASCADE,
  -- Owning app, when the route was attached from a project (SET NULL: the
  -- route survives app deletion only long enough to be cleaned explicitly).
  "project_id" text REFERENCES "project"("id") ON DELETE SET NULL,
  "hostname" text NOT NULL,
  "target_port" integer NOT NULL,
  "zone_id" text,
  "dns_record_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cf_tunnel_routes_hostname" ON "cf_tunnel_routes" ("hostname");
CREATE INDEX IF NOT EXISTS "idx_cf_tunnel_routes_tunnel" ON "cf_tunnel_routes" ("tunnel_id");
