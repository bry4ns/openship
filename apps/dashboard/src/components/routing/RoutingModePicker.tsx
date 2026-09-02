"use client";

import React, { useEffect, useRef, useState } from "react";
import { isApexDomain } from "@repo/core";
import { useI18n } from "@/components/i18n-provider";
import { api } from "@/lib/api";
import PublicEndpointsCard from "@/components/routing/PublicEndpointsCard";
import { createPublicEndpoint, type PublicEndpoint } from "@/context/deployment/types";

/**
 * Free / Custom / Cloudflare / None routing picker, rendered as a COMPACT
 * segmented tab (the same style as the compose/docker wizard's domain tabs)
 * rather than tall stacked cards. "None" = no public route — the deploy builds
 * and runs but nothing is exposed; the backend treats an empty publicEndpoints
 * set as no route (preflight warns, no Cloud gate). Free/Custom drive the
 * endpoint's domainType; the inner card's own type toggle is hidden
 * (`hideTypeToggle`) so this picker is the single source of the free-vs-custom
 * choice. "Cloudflare" publishes through the instance's connected Cloudflare
 * account: pick a zone, type a subdomain, and the tunnel + DNS + plain-HTTP
 * vhost are provisioned automatically.
 */
export type RoutingMode = "free" | "custom" | "cloudflare" | "none";

export interface RoutingModeLabels {
  /** Label for the "None" tab (Free/Custom reuse the shared settingsCard i18n
   *  so they read identically to the wizard's domain tabs). */
  noneLabel: string;
  /** One-line explainer shown under the tabs while "None" is selected. */
  noneDesc: string;
}

interface RoutingModePickerProps {
  mode: RoutingMode;
  onModeChange: (mode: RoutingMode) => void;
  labels: RoutingModeLabels;
  // PublicEndpointsCard passthrough (rendered only when mode !== "none").
  projectName: string;
  endpoints: PublicEndpoint[];
  hasServer: boolean;
  runtimePort: string;
  onEndpointsChange: (endpoints: PublicEndpoint[], runtimePort?: string) => void;
  allowPortEdit?: boolean;
  saveMode?: "change" | "explicit";
  /** Show the per-endpoint "Redirect to" control. Matters here because the www
   *  toggle CREATES a redirect — hiding the control would leave the user with a
   *  301 they didn't see and can't change. */
  allowRedirects?: boolean;
  /** Node the Cloudflare connector will run on (the deploy target). Shown in the
   *  ☁ tab so the operator sees WHICH server gets the tunnel. Undefined = the
   *  OpenShip box itself. */
  tunnelNode?: string;
}

// Segmented tab styling — identical to RoutingSettingsCard's Free/Custom tabs so
// the whole app switches domain type the same way.
const TAB_BASE = "px-4 py-2 rounded-xl text-sm font-medium transition-colors";
const TAB_ON = "bg-primary/10 text-primary ring-1 ring-primary/15";
const TAB_OFF = "bg-muted/40 text-muted-foreground hover:bg-muted/60";

export function RoutingModePicker({
  mode,
  onModeChange,
  labels,
  projectName,
  endpoints,
  hasServer,
  runtimePort,
  onEndpointsChange,
  allowPortEdit = false,
  saveMode = "change",
  allowRedirects = false,
  tunnelNode,
}: RoutingModePickerProps) {
  const { t } = useI18n();
  const w = t.widgets.routing.settingsCard;

  // Cloudflare zones from the instance's connected account (empty when not
  // connected — the ☁ tab then explains how to connect).
  const [cfZones, setCfZones] = useState<Array<{ zoneId: string; name: string }>>([]);
  useEffect(() => {
    api
      .get<{ connected: boolean; zones?: Array<{ zoneId: string; name: string }> }>(
        "system/integrations/cloudflare",
      )
      .then((r) => {
        if (r.connected) setCfZones(r.zones ?? []);
      })
      .catch(() => {});
  }, []);

  const primary = endpoints[0];
  const cfHost = primary?.domainType === "custom" ? primary.customDomain : "";
  const cfSub = cfHost.includes(".")
    ? cfHost.slice(0, cfHost.lastIndexOf("."))
    : normalizeSub(projectName);
  const cfZone = cfHost.includes(".") ? cfHost.slice(cfHost.lastIndexOf(".") + 1) : cfZones[0]?.name ?? "";

  function normalizeSub(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "app";
  }

  /**
   * Compose `sub.zone` into the primary endpoint and mark it externalIngress.
   * The autosave in the caller persists it; the CF attach itself lives in the
   * deploy wizard's DomainSettings (which knows projectId + target node).
   */
  const setCfHost = (sub: string, zone: string) => {
    if (!zone) return;
    const host = `${sub}.${zone}`;
    const base =
      endpoints[0] ??
      createPublicEndpoint({ domainType: "custom", customDomain: host });
    const port = hasServer && runtimePort ? { port: runtimePort } : {};
    onEndpointsChange([
      {
        ...base,
        domainType: "custom",
        customDomain: host,
        externalIngress: true,
        ...port,
      },
      ...endpoints.slice(1),
    ]);
  };

  // Fully automatic: switching to ☁ Cloudflare immediately reserves a generated
  // subdomain on the first connected zone (like Free DNS does with the slug),
  // instead of leaving an empty hostname until the operator types. No-op when a
  // hostname is already committed (a reload / an edited one stays as-is), and
  // fires again only if the endpoint ends up with no hostname at all.
  const autoCommittedRef = useRef(false);
  useEffect(() => {
    if (mode !== "cloudflare") {
      autoCommittedRef.current = false;
      return;
    }
    if (cfZones.length === 0) return;
    const current = endpoints[0]?.domainType === "custom" ? (endpoints[0]?.customDomain ?? "") : "";
    if (current.includes(".")) {
      autoCommittedRef.current = true;
      return;
    }
    if (autoCommittedRef.current) return;
    autoCommittedRef.current = true;
    setCfHost(normalizeSub(projectName), cfZones[0].name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cfZones, projectName, endpoints]);

  // The apex the www variant would attach to: the first custom endpoint's hostname,
  // but ONLY when it's a real registrable apex — `www.<subdomain>` is nonsensical,
  // so a subdomain (app.example.com) or an already-www host offers no www toggle.
  const apex = endpoints.find((e) => e.domainType === "custom")?.customDomain?.trim().toLowerCase();
  const wwwCandidate = apex && isApexDomain(apex) ? apex : null;
  const wwwIncluded =
    !!wwwCandidate &&
    endpoints.some(
      (e) => e.domainType === "custom" && e.customDomain?.trim().toLowerCase() === `www.${wwwCandidate}`,
    );

  /**
   * Add/remove the `www.` endpoint, mirroring the apex's port or target path.
   *
   * The sibling starts as a 301 to the apex: it's a full, independent endpoint
   * (own DNS record, own verification, own certificate) whose job is to funnel
   * traffic to the canonical host. Two hostnames both serving the app is
   * duplicate content, and picking a canonical one later is a migration; the
   * direction is editable on the endpoint's own card either way.
   */
  const toggleWww = (on: boolean) => {
    if (!wwwCandidate) return;
    const host = `www.${wwwCandidate}`;
    if (!on) {
      onEndpointsChange(
        endpoints.filter(
          (e) => !(e.domainType === "custom" && e.customDomain?.trim().toLowerCase() === host),
        ),
      );
      return;
    }
    const primaryEp = endpoints.find((e) => e.domainType === "custom");
    onEndpointsChange([
      ...endpoints,
      createPublicEndpoint({
        domainType: "custom",
        customDomain: host,
        redirectTo: wwwCandidate,
        redirectStatus: 301,
        ...(primaryEp?.port ? { port: primaryEp.port } : {}),
        ...(primaryEp?.targetPath ? { targetPath: primaryEp.targetPath } : {}),
      }),
    ]);
  };
  const tabs: Array<{ value: RoutingMode; label: string }> = [
    { value: "free", label: w.free },
    { value: "custom", label: w.custom },
    ...(cfZones.length > 0 ? [{ value: "cloudflare" as RoutingMode, label: "☁ Cloudflare" }] : []),
    { value: "none", label: labels.noneLabel },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onModeChange(tab.value)}
            aria-pressed={mode === tab.value}
            className={`${TAB_BASE} ${mode === tab.value ? TAB_ON : TAB_OFF}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {mode === "none" ? (
        <p className="px-1 pt-0.5 text-xs text-muted-foreground">{labels.noneDesc}</p>
      ) : mode === "cloudflare" ? (
        cfZones.length === 0 ? (
          <p className="px-1 pt-0.5 text-xs text-muted-foreground">
            Connect a Cloudflare account in Settings → Cloudflare Tunnel first.
          </p>
        ) : (
          <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={cfSub}
                onChange={(e) => setCfHost(e.target.value.trim().toLowerCase(), cfZone)}
                placeholder={normalizeSub(projectName)}
                className="w-44 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <span className="text-muted-foreground">.</span>
              <select
                value={cfZone}
                onChange={(e) => setCfHost(cfSub || normalizeSub(projectName), e.target.value)}
                className="rounded-xl border border-border/50 bg-background px-3 py-2 text-sm"
              >
                {cfZones.map((z) => (
                  <option key={z.zoneId} value={z.name}>
                    {z.name}
                  </option>
                ))}
              </select>
              {hasServer && (
                <input
                  value={primary?.port ?? runtimePort}
                  onChange={(e) =>
                    onEndpointsChange(
                      [
                        {
                          ...(endpoints[0] ??
                            createPublicEndpoint({
                              domainType: "custom",
                              customDomain: `${cfSub || normalizeSub(projectName)}.${cfZone}`,
                            })),
                          port: e.target.value.replace(/\D/g, ""),
                          externalIngress: true,
                        },
                        ...endpoints.slice(1),
                      ],
                      e.target.value,
                    )
                  }
                  placeholder="Port"
                  inputMode="numeric"
                  className="w-24 rounded-xl border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              → https://{cfHost || `${normalizeSub(projectName)}.${cfZone}`} · DNS, TLS and the
              edge vhost are provisioned automatically (analytics included)
              {tunnelNode ? ` · Túnel en: ${tunnelNode}` : ""}.
            </p>
          </div>
        )
      ) : (
        <div className="pt-1">
          {/* `www.<apex>` is appended as its OWN endpoint (publicEndpoints is what
              routing reconciles against — a flag on the apex would be dropped by the
              same reconciler). The toggle now lives as the first row INSIDE the domain
              card (a Switch), shown only for a real apex — never a subdomain. */}
          <PublicEndpointsCard
            projectName={projectName}
            endpoints={endpoints}
            hasServer={hasServer}
            runtimePort={runtimePort}
            allowPortEdit={allowPortEdit}
            saveMode={saveMode}
            hideTypeToggle
            allowRedirects={allowRedirects}
            onChange={onEndpointsChange}
            wwwToggle={
              mode === "custom"
                ? {
                    show: !!wwwCandidate,
                    included: wwwIncluded,
                    apex: wwwCandidate,
                    onToggle: toggleWww,
                  }
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
