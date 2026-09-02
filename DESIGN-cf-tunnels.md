# Cloudflare Tunnels — integrated support (design v2)

Branch: `feat/cloudflare-tunnels` (based on `fix/accept-invite-logged-out`, on
upstream `main` @ e1c3986d).

## The experience this builds

One-time setup, then invisible:

1. **Connect Cloudflare once** (Settings → Integrations → Cloudflare): paste a
   Cloudflare **API token**. Openship validates it and lists your zones
   (domains) — that is the "detect available domains" feature.
2. **Add any server** (SSH) or use the local box — nothing tunnel-specific to
   do yet.
3. **Deploy an app anywhere**: the domain picker gains a fourth option —

   ```
   ( ) Custom domain   (edge + Let's Encrypt, needs open ports)
   (•) Cloudflare Tunnel   ← pick domain from dropdown, type subdomain
   ( ) IP only
   ( ) No domain
   ```

4. Behind the scenes on first tunneled deploy to a node: Openship creates a
   tunnel via the Cloudflare API, installs the `cloudflared` **container** on
   that node (docker is already a prerequisite Openship manages), registers the
   ingress route (`hostname → http://localhost:<appPort>`) via API, creates the
   DNS record, starts the connector. Next deploys to the same node reuse the
   tunnel and just append ingress entries.
5. Deleting the app removes its ingress entry + DNS record. Removing the last
   route stops the connector.

Works identically for the local instance and every remote server: a tunnel is
a per-node object; the Cloudflare credential is account-wide.

## Two different secrets (do not confuse)

| Secret | Scope | Used for |
|---|---|---|
| **Cloudflare API token** | One per Openship instance | List zones, create/delete tunnels, write ingress configs, create/delete DNS records. Needs `Account: Cloudflare Tunnel: Edit` + `Zone: DNS: Edit` (+ `Zone: Zone: Read`) |
| **Tunnel connector token** | One per tunnel (per node) | What `cloudflared` runs with. Obtained automatically via API — the user never handles it |

The old v1 idea of "paste the dashboard tunnel token" is dropped: with an API
token the whole lifecycle is automated, which is what makes the deploy-time
menu possible.

## Traffic path

```
visitor → https://sub.domain.tld (Cloudflare edge, TLS)
        → <tunnel-id>.cfargotunnel.com (CNAME, proxied, auto-created)
        → cloudflared container on the app's node (outbound-only connection)
        → http://localhost:<appPort>
```

No inbound ports, no certbot, NAT-friendly. Real visitor IPs already work —
the edge trusts Cloudflare ranges (`packages/adapters/src/infra/
cloudflare-ips.generated.ts`).

## Schema (migration 0112_cf_tunnels.sql)

```sql
-- one row per connected Cloudflare account (v1 UI allows exactly one)
CREATE TABLE IF NOT EXISTS "cf_accounts" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL,               -- Cloudflare account id (from API)
  "email_or_name" text NOT NULL,            -- label shown in UI
  "api_token_ciphertext" text NOT NULL,     -- encrypt()
  "zones_cache" jsonb NOT NULL DEFAULT '[]',-- [{name, zone_id}] refreshed lazily
  "created_at" timestamp NOT NULL DEFAULT now(),
  UNIQUE ("organization_id", "account_id")
);

-- one tunnel per (server | local instance)
CREATE TABLE IF NOT EXISTS "cf_tunnels" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "cf_account_row_id" text NOT NULL REFERENCES "cf_accounts"("id") ON DELETE CASCADE,
  "server_id" text,                         -- NULL = the local/OpenShip box
  "cf_tunnel_id" text NOT NULL UNIQUE,      -- Cloudflare's tunnel uuid
  "connector_token_ciphertext" text NOT NULL,
  "status" text NOT NULL DEFAULT 'stopped', -- stopped|running|error
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "cf_tunnel_routes" (
  "id" text PRIMARY KEY,
  "tunnel_id" text NOT NULL REFERENCES "cf_tunnels"("id") ON DELETE CASCADE,
  "project_id" text,                        -- link to the app (integration feel)
  "hostname" text NOT NULL UNIQUE,          -- sub.domain.tld
  "target_port" integer NOT NULL,
  "dns_record_id" text,                     -- for cleanup on delete
  "created_at" timestamp NOT NULL DEFAULT now()
);
```

## Backend pieces

- `packages/adapters/src/infra/cloudflare-client.ts` — thin typed REST client
  (fetch): verify token, list accounts/zones, create/delete tunnel, get
  connector token, put ingress configuration, create/delete DNS record.
- `apps/api/src/lib/cf-tunnel-manager.ts` — per-node container lifecycle via
  the existing SSH/docker tooling (`ensureFeature` path already installs
  docker on servers): ensure image, run with connector token, status, logs.
- Ingress management via **Cloudflare API** (`PUT
  /cfd_tunnel/{id}/configurations`) — remote-managed config. No config files
  to ship to nodes; adding/removing a route is one API call + zero restarts
  (cloudflared picks up ingress changes live).
- `apps/api/src/modules/system/cf.controller.ts` + routes in
  `system.routes.ts`:
  - `GET|PUT /integrations/cloudflare` (connect/disconnect account, zones)
  - `GET /servers/:id/cloudflare/status` (tunnel + container state)
  - Domain-picker support: `GET /integrations/cloudflare/domains`
  - Internals used by the deploy pipeline (not raw CRUD for users):
    `ensureNodeTunnel(serverId)`, `attachRoute(projectId, hostname, port)`,
    `detachRoute(routeId)`.

## Deploy-pipeline hook (the actual "menu")

Where the project wizard renders domain options
(`project-crud.service.ts` / dashboard Source & Domains tabs), add option
`cloudflare_tunnel`. On deploy with that choice:

1. resolve/create the node's tunnel (first time: create + install container),
2. `attachRoute()` → ingress + DNS + row,
3. surface the resulting URL as the app's primary domain
   (`domains.project-route.service.ts` learns a second origin kind;
   edge/certbot paths untouched).

Deleting the app detaches its route(s); last route out stops the connector.

## Dashboard UI

- **Settings → Integrations → Cloudflare**: paste API token, see account +
  zones badge, disconnect.
- **Project create/edit → domain step**: new option with domain dropdown
  (from zones cache) + subdomain input + live URL preview.
- **App page → Domains tab**: tunneled hostname listed with a ⛅ marker +
  "managed by Cloudflare Tunnel" hint instead of TLS/certbot controls.
- **Server page**: small "Cloudflare Tunnel: running/stopped" indicator once
  a tunnel exists there.

## Update survival (fork reality)

Openship has no plugin system (RFC #521 open). The feature lives in this fork;
per upstream release: `git fetch upstream && git rebase upstream/main` →
rebuild/push own tags (`ghcr.io/bry4ns/openship-{api,dashboard}:<ver>-cf`,
automatable with fork Actions) → flip `OPENSHIP_IMAGE_REGISTRY` /
`OPENSHIP_VERSION` in `~/.openship/compose/.env` → `docker compose up -d`.
Data volumes untouched. Once stable, propose upstream (issue first, per
CONTRIBUTING) so it becomes official and the ritual disappears.

## Phases

- **P1**: cf client + migration + manager + connect-token UI + manual tunnel
  attach for ONE app (proves end-to-end on the real box).
- **P2**: domain-picker option in the project wizard + auto-install-on-deploy
  + per-app detach on delete + server indicator.
- **P3**: polish (route suggestions from known ports, dashboard self-publish),
  docs, upstream issue + PR.

## Risks / notes

- Depends on Cloudflare being reachable from the node (outbound only) — if CF
  is down, tunneled hostnames are down (same tradeoff as anyone using CF).
- API rate limits are generous; zones cached in `cf_accounts.zones_cache` to
  stay lazy.
- Remote-managed ingress means Zero Trust dashboard edits and Openship edits
  both mutate the same config — acceptable; document it.
- Token scopes are powerful: stored encrypted, never returned to the browser
  after save (write-only field).
