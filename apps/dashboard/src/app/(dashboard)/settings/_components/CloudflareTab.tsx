"use client";

/**
 * Settings → Cloudflare Tunnels.
 *
 * One-time API-token connection, then per-node tunnels with their published
 * hostname→port routes. Everything below talks to /api/system/integrations/
 * cloudflare and /api/system/cf-tunnels/*; secrets never round-trip through
 * the browser (token fields are write-only).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Cloud, Plus, Trash2, Play, Square, RefreshCw } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";

type Zone = { zoneId: string; name: string };

type TunnelSummary = {
  id: string;
  name: string;
  serverId: string | null;
  serverName?: string | null;
  node: string;
  status: string;
  lastError?: string | null;
  routeCount: number;
};

type IntegrationInfo =
  | { connected: false }
  | { connected: true; label: string; zones: Zone[]; tunnels: TunnelSummary[] };

type RouteRow = { id: string; hostname: string; targetPort: number; mode?: string; projectId?: string | null };

export function CloudflareTab() {
  const [info, setInfo] = useState<IntegrationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  const [servers, setServers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedNode, setSelectedNode] = useState<string>("__local__");

  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [activeTunnel, setActiveTunnel] = useState<string | null>(null);
  const [newHost, setNewHost] = useState("");
  const [newPort, setNewPort] = useState("");
  const [routeMode, setRouteMode] = useState<"app" | "edge">("edge");
  const [routeProject, setRouteProject] = useState<string>("");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<IntegrationInfo>("system/integrations/cloudflare");
      setInfo(res);
      if (res.connected && res.tunnels[0]) {
        await selectTunnel(res.tunnels[0].id);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load integration"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
    api
      .get<{ id: string; name: string }[]>("system/servers")
      .then((s) => setServers(Array.isArray(s) ? s : []))
      .catch(() => setServers([]));
    api
      .get<{ success: boolean; projects: Array<{ id: string; name: string }> }>(
        "projects/home",
      )
      .then((r) => setProjects(r.projects ?? []))
      .catch(() => setProjects([]));
  }, [load]);

  const selectTunnel = async (id: string) => {
    setActiveTunnel(id);
    try {
      const st = await api.get<{ routes: RouteRow[] }>(`system/cf-tunnels/${id}/status`);
      setRoutes(st.routes ?? []);
    } catch {
      setRoutes([]);
    }
  };

  const connect = async () => {
    if (!tokenInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.put("system/integrations/cloudflare", { apiToken: tokenInput.trim() });
      setTokenInput("");
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to connect"));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Disconnect Cloudflare and remove all tunnels and routes?")) return;
    setBusy(true);
    try {
      await api.delete("system/integrations/cloudflare");
      setRoutes([]);
      setActiveTunnel(null);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to disconnect"));
    } finally {
      setBusy(false);
    }
  };

  const ensureTunnel = async () => {
    setBusy(true);
    setError(null);
    try {
      const serverId = selectedNode === "__local__" ? null : selectedNode;
      const res = await api.post<{ tunnel: { id: string } }>("system/cf-tunnels/ensure", { serverId });
      await load();
      await selectTunnel(res.tunnel.id);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to enable tunnel on node"));
    } finally {
      setBusy(false);
    }
  };

  const tunnelAction = async (id: string, action: "start" | "stop") => {
    setBusy(true);
    try {
      await api.post(`system/cf-tunnels/${id}/${action}`);
      await load();
      await selectTunnel(id);
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to ${action} tunnel`));
    } finally {
      setBusy(false);
    }
  };

  const deleteTunnel = async (id: string) => {
    if (!confirm("Delete this tunnel and all its routes?")) return;
    setBusy(true);
    try {
      await api.delete(`system/cf-tunnels/${id}`);
      setRoutes([]);
      setActiveTunnel(null);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to delete tunnel"));
    } finally {
      setBusy(false);
    }
  };

  const addRoute = async () => {
    if (!activeTunnel || !newHost.trim() || !newPort.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ route: RouteRow }>(`system/cf-tunnels/${activeTunnel}/routes`, {
        hostname: newHost.trim(),
        targetPort: Number(newPort),
        mode: routeMode,
        projectId: routeMode === "edge" ? routeProject || undefined : undefined,
      });
      setRoutes((prev) => [...prev.filter((r) => r.id !== res.route.id), res.route]);
      setNewHost("");
      setNewPort("");
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to publish hostname"));
    } finally {
      setBusy(false);
    }
  };

  const removeRoute = async (rid: string) => {
    if (!activeTunnel) return;
    setBusy(true);
    try {
      await api.delete(`system/cf-tunnels/${activeTunnel}/routes/${rid}`);
      setRoutes((prev) => prev.filter((r) => r.id !== rid));
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to remove route"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Cloud className="size-5 text-primary" />
        <h3 className="text-lg font-semibold">Cloudflare Tunnels</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Publish apps without opening ports or managing TLS certificates. Traffic flows
        visitor → Cloudflare edge → an outbound cloudflared connector → your app.
      </p>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!info?.connected ? (
        <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
          <p className="text-sm font-medium">Connect your Cloudflare account</p>
          <ol className="list-decimal list-inside text-xs text-muted-foreground space-y-1">
            <li>
              In Cloudflare: My Profile → API Tokens → Create Token with
              <code className="mx-1 rounded bg-muted px-1">Account · Cloudflare Tunnel: Edit</code>,
              <code className="mx-1 rounded bg-muted px-1">Zone · DNS: Edit</code>and
              <code className="mx-1 rounded bg-muted px-1">Zone · Zone: Read</code>.
            </li>
            <li>Paste the token below.</li>
          </ol>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Cloudflare API token"
            className="w-full rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={connect}
            disabled={busy || !tokenInput.trim()}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Connect
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm">
                Connected as <strong>{info.label}</strong> ·{" "}
                {info.zones.length} domain{info.zones.length === 1 ? "" : "s"}
              </div>
              <button
                onClick={disconnect}
                disabled={busy}
                className="text-xs text-destructive hover:underline disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>
            {info.zones.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {info.zones.map((z) => (
                  <span key={z.zoneId} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {z.name}
                  </span>
                ))}
              </div>
            )}

            {/* Enable tunnel on a node */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                value={selectedNode}
                onChange={(e) => setSelectedNode(e.target.value)}
                className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm"
              >
                <option value="__local__">This box (OpenShip)</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                onClick={ensureTunnel}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Enable tunnel on node
              </button>
            </div>
          </div>

          {/* Tunnels */}
          <div className="space-y-3">
            {info.tunnels.map((t) => (
              <div
                key={t.id}
                className={`rounded-2xl border p-4 space-y-3 cursor-pointer transition-colors ${
                  activeTunnel === t.id
                    ? "border-primary/60 bg-card"
                    : "border-border/50 bg-card hover:border-primary/30"
                }`}
                onClick={() => void selectTunnel(t.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={`inline-block size-2 rounded-full ${
                        t.status === "running"
                          ? "bg-emerald-500"
                          : t.status === "error"
                            ? "bg-red-500"
                            : "bg-zinc-400"
                      }`}
                    />
                    <span className="font-medium">{t.node}</span>
                    <span className="text-muted-foreground">· {t.routeCount} route(s)</span>
                  </div>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      title="Refresh status"
                      onClick={() => void selectTunnel(t.id)}
                      className="rounded-lg p-1.5 hover:bg-muted"
                    >
                      <RefreshCw className="size-4" />
                    </button>
                    {t.status === "running" ? (
                      <button
                        title="Stop connector"
                        onClick={() => void tunnelAction(t.id, "stop")}
                        className="rounded-lg p-1.5 hover:bg-muted"
                      >
                        <Square className="size-4" />
                      </button>
                    ) : (
                      <button
                        title="Start connector"
                        onClick={() => void tunnelAction(t.id, "start")}
                        className="rounded-lg p-1.5 hover:bg-muted"
                      >
                        <Play className="size-4" />
                      </button>
                    )}
                    <button
                      title="Delete tunnel"
                      onClick={() => void deleteTunnel(t.id)}
                      className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {t.lastError && (
                  <p className="text-xs text-destructive">{t.lastError}</p>
                )}

                {activeTunnel === t.id && (
                  <div className="space-y-2 pt-1" onClick={(e) => e.stopPropagation()}>
                    <table className="w-full text-sm">
                      <tbody>
                        {routes.map((r) => (
                          <tr key={r.id} className="border-t border-border/40">
                            <td className="py-1.5 pr-2">
                              <a
                                href={`https://${r.hostname}`}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline"
                              >
                                {r.hostname}
                              </a>
                            </td>
                            <td className="py-1.5 pr-2 text-muted-foreground">
                              {r.mode === "edge" ? (
                                <span title="Via OpenResty — analytics included">
                                  ⛅ via edge · :{r.targetPort}
                                </span>
                              ) : (
                                <span title="Direct to app port — bypasses edge stats">
                                  ⚡ direct · :{r.targetPort}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 w-8 text-right">
                              <button
                                onClick={() => void removeRoute(r.id)}
                                disabled={busy}
                                className="rounded-lg p-1 text-destructive hover:bg-destructive/10 disabled:opacity-60"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {routes.length === 0 && (
                          <tr>
                            <td className="py-1.5 text-muted-foreground" colSpan={3}>
                              No hostnames published yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <select
                        value={routeMode}
                        onChange={(e) => setRouteMode(e.target.value as "app" | "edge")}
                        className="rounded-xl border border-border/50 bg-background px-3 py-1.5 text-sm"
                      >
                        <option value="edge">⛅ Via edge (stats)</option>
                        <option value="app">⚡ Direct to port</option>
                      </select>
                      {routeMode === "edge" && (
                        <select
                          value={routeProject}
                          onChange={(e) => setRouteProject(e.target.value)}
                          className="max-w-[200px] rounded-xl border border-border/50 bg-background px-3 py-1.5 text-sm"
                        >
                          <option value="">Select project…</option>
                          {projects.map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        value={newHost}
                        onChange={(e) => setNewHost(e.target.value)}
                        placeholder={`subdomain.${info.zones[0]?.name ?? "your-domain.com"}`}
                        className="min-w-[220px] flex-1 rounded-xl border border-border/50 bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                      />
                      <input
                        value={newPort}
                        onChange={(e) => setNewPort(e.target.value.replace(/\D/g, ""))}
                        placeholder="Port"
                        inputMode="numeric"
                        className="w-24 rounded-xl border border-border/50 bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                      />
                      <button
                        onClick={addRoute}
                        disabled={busy || !newHost.trim() || !newPort}
                        className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        <Plus className="size-4" />
                        Publish
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
