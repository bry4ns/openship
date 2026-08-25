/**
 * Minimal typed client for the Cloudflare REST API (v4) — just the surface the
 * Cloudflare Tunnels integration needs:
 *
 *   verify token → list accounts → list zones → create/delete tunnel →
 *   read connector token → PUT remote-managed ingress → CNAME records.
 *
 * Auth: `Authorization: Bearer <api token>`; every response is enveloped as
 * `{ success, result, errors }`. We unwrap `success` and surface `result`,
 * throwing a compact error built from `errors` otherwise.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface CfError {
  code: number;
  message: string;
}

async function cfRequest<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CF_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Cloudflare API unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: T; errors?: CfError[] }
    | null;

  if (!res.ok || !json?.success) {
    const detail = (json?.errors ?? [])
      .map((e) => `${e.code}: ${e.message}`)
      .join("; ");
    throw new Error(
      detail
        ? `Cloudflare API error (${res.status}): ${detail}`
        : `Cloudflare API error: HTTP ${res.status}`,
    );
  }
  return json.result as T;
}

// ─── Token / account / zone discovery ────────────────────────────────────────

/** Verify an API token. Throws with Cloudflare's reason when invalid. */
export async function verifyApiToken(token: string): Promise<void> {
  await cfRequest<{ id: string; status: string }>(
    token,
    "GET",
    "/user/tokens/verify",
  );
}

export interface CfAccount {
  id: string;
  name: string;
}

export async function listAccounts(token: string): Promise<CfAccount[]> {
  // NOTE: cfRequest already unwraps the { success, result } envelope.
  return cfRequest<CfAccount[]>(token, "GET", "/accounts?per_page=5");
}

export interface CfZone {
  zoneId: string;
  name: string;
}

export async function listZones(token: string, accountId: string): Promise<CfZone[]> {
  const res = await cfRequest<
    Array<{ id: string; name: string }>
  >(token, "GET", `/zones?account.id=${encodeURIComponent(accountId)}&per_page=50`);
  return res.map((z) => ({ zoneId: z.id, name: z.name }));
}

/**
 * Zones across ALL accessible accounts, each carrying its owning account ids.
 *
 * Tokens commonly scope `Zone · Read` per-zone while omitting account-level
 * read — `/accounts` then comes back EMPTY even though the token works fine
 * for tunnels/DNS inside those zones. This fallback derives the account from
 * the zones themselves so such tokens still connect.
 */
export async function listZonesWithAccount(
  token: string,
): Promise<Array<CfZone & { accountId: string; accountName: string }>> {
  const res = await cfRequest<
    Array<{
      id: string;
      name: string;
      account: { id: string; name: string };
    }>
  >(token, "GET", "/zones?per_page=50");
  return res.map((z) => ({
    zoneId: z.id,
    name: z.name,
    accountId: z.account?.id ?? "",
    accountName: z.account?.name ?? "Cloudflare",
  }));
}

// ─── Tunnels ─────────────────────────────────────────────────────────────────

export interface CfTunnelCreated {
  id: string;
  name: string;
  status: string;
}

export async function createTunnel(
  token: string,
  accountId: string,
  name: string,
): Promise<CfTunnelCreated> {
  // config_src "cloudflare" = remote-managed ingress (we PUT configurations).
  return cfRequest<CfTunnelCreated>(token, "POST", `/accounts/${accountId}/cfd_tunnel`, {
    name,
    config_src: "cloudflare",
  });
}

export async function deleteTunnel(
  token: string,
  accountId: string,
  tunnelId: string,
): Promise<void> {
  await cfRequest<unknown>(token, "DELETE", `/accounts/${accountId}/cfd_tunnel/${tunnelId}`);
}

/** The connector token cloudflared runs with (`TUNNEL_TOKEN` env). */
export async function getConnectorToken(
  token: string,
  accountId: string,
  tunnelId: string,
): Promise<string> {
  // The endpoint returns the raw token STRING as result, not an envelope object.
  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: string; errors?: CfError[] }
    | null;
  if (!res.ok || !json?.success || !json.result) {
    const detail = (json?.errors ?? []).map((e) => e.message).join("; ");
    throw new Error(`Failed to read connector token: ${detail || res.status}`);
  }
  return json.result;
}

export interface CfIngressRule {
  hostname?: string;
  service: string; // e.g. "http://localhost:3000" or "http_status:404"
}

/**
 * Replace a tunnel's remote-managed ingress configuration. The final rule MUST
 * be the catch-all; callers build the full list — we only enforce the shape.
 */
export async function putIngressConfig(
  token: string,
  accountId: string,
  tunnelId: string,
  ingress: CfIngressRule[],
): Promise<void> {
  if (ingress.length === 0 || !ingress[ingress.length - 1].service.startsWith("http_status:")) {
    throw new Error("Ingress config must end with a catch-all http_status rule");
  }
  await cfRequest<unknown>(token, "PUT", `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
    config: { ingress },
  });
}

// ─── DNS ─────────────────────────────────────────────────────────────────────

export interface DnsRecordCreated {
  id: string;
}

/** Proxied CNAME `<hostname>` → `<tunnelId>.cfargotunnel.com`. */
export async function createTunnelDnsRecord(
  token: string,
  zoneId: string,
  hostname: string,
  tunnelId: string,
): Promise<DnsRecordCreated> {
  return cfRequest<DnsRecordCreated>(token, "POST", `/zones/${zoneId}/dns_records`, {
    type: "CNAME",
    name: hostname,
    content: `${tunnelId}.cfargotunnel.com`,
    proxied: true,
    ttl: 1, // auto when proxied
  });
}

export async function deleteDnsRecord(
  token: string,
  zoneId: string,
  recordId: string,
): Promise<void> {
  await cfRequest<unknown>(token, "DELETE", `/zones/${zoneId}/dns_records/${recordId}`);
}
