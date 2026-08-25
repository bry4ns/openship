"use client";

/**
 * Settings → Cloudflare Tunnel.
 *
 * Read-mostly operations view: connection status and the per-node connectors
 * with their published hostnames. Publishing/removing hostnames lives where it
 * belongs — each app's Domains tab — so this page never edits routing data.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Cloud, Trash2, Play, Square, RefreshCw } from "lucide-react";
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

type RouteRow = { id: string; hostname: string; targetPort: number; mode?: string };

export function CloudflareTab() {
  const [info, setInfo] = useState<IntegrationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [activeTunnel, setActiveTunnel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<IntegrationInfo>("system/integrations/cloudflare");
      setInfo(res);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load integration"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectTunnel = async (id: string) => {
    setActiveTunnel(id === activeTunnel ? null : id);
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
    if (!confirm("Disconnect Cloudflare? This removes all tunnels and their published hostnames.")) return;
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
      await api.post("system/cf-tunnels/ensure", {});
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to enable tunnel"));
    } finally {
      setBusy(false);
    }
  };

  const tunnelAction = async (id: string, action: "start" | "stop") => {
    setBusy(true);
    try {
      await api.post(`system/cf-tunnels/${id}/${action}`);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to ${action} tunnel`));
    } finally {
      setBusy(false);
    }
  };

  const deleteTunnel = async (id: string) => {
    if (!confirm("Delete this tunnel? Its published hostnames stop resolving.")) return;
    setBusy(true);
    try {
      await api.delete(`system/cf-tunnels/${id}`);
      if (activeTunnel === id) {
        setActiveTunnel(null);
        setRoutes([]);
      }
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to delete tunnel"));
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
        Connectors that expose your apps through Cloudflare without open ports or
        certificates. Hostnames are published from each app's{" "}
        <strong>Domains</strong> tab — this page is status and lifecycle only.
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
          {/* Connection */}
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
          </div>

          {/* Enable on this box */}
          {!info.tunnels.some((t) => t.serverId === null) && (
            <div className="flex items-center justify-between rounded-2xl border border-border/50 bg-card p-4">
              <div className="text-sm text-muted-foreground">
                This box has no tunnel yet.
              </div>
              <button
                onClick={ensureTunnel}
                disabled={busy}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                Enable on this box
              </button>
            </div>
          )}

          {/* Nodes */}
          <div className="space-y-3">
            {info.tunnels.map((t) => (
              <div key={t.id} className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
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
                    <span className="text-muted-foreground">· {t.routeCount} hostname(s)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      title="Refresh"
                      onClick={() => void load()}
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

                {t.lastError && <p className="text-xs text-destructive">{t.lastError}</p>}

                {activeTunnel === t.id &&
                  (t.routeCount > 0 ? (
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
                            <td className="py-1.5 text-right text-muted-foreground">
                              {r.mode === "edge" ? "via edge" : `direct :${r.targetPort}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No hostnames published yet — publish one from an app's Domains tab.
                    </p>
                  ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
