/**
 * Cloudflared connector container lifecycle — the runtime half of the
 * Cloudflare Tunnels integration.
 *
 * One `cloudflare/cloudflared` container per node that needs exposure:
 *   - local node (serverId null) → commands run through the host executor
 *     (the control-plane box itself, docker socket mounted);
 *   - remote node → through sshManager (docker is an OpenShip-managed
 *     prerequisite on every deployable server).
 *
 * The connector authenticates with `TUNNEL_TOKEN` (env), which we obtain from
 * the Cloudflare API at tunnel creation time and store encrypted. The ingress
 * mapping lives remote-managed on Cloudflare's side — this container never
 * needs config files, so "add/remove route" is purely an API call plus this
 * container simply staying up.
 */

import { createHostExecutor } from "@repo/adapters";
import { sshManager } from "./ssh-manager";

export const CLOUDFLARED_CONTAINER = "openship-cloudflared";
const CLOUDFLARED_IMAGE = "cloudflare/cloudflared:latest";

export interface NodeCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run one shell command on a node. `serverId` null = the OpenShip box itself
 * (host executor); otherwise the SSH server row.
 */
async function runOnNode(
  serverId: string | null,
  opId: string,
  command: string,
): Promise<NodeCommandResult> {
  if (serverId) {
    const r = await sshManager.run(serverId, opId, command);
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  }
  try {
    const stdout = await createHostExecutor().exec(command);
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    // exec() rejects on non-zero exit with combined output in the message.
    return { code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

/** Defensive: the token rides an env var; it must not be able to break quoting. */
function safeToken(token: string): string {
  const cleaned = token.replace(/['"\\\s]/g, "");
  if (!cleaned) throw new Error("Empty Cloudflare connector token");
  return cleaned;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * (Re)create the cloudflared container on a node and leave it running.
 * Idempotent: replaces any previous instance of the same container name.
 */
export async function ensureConnectorRunning(
  serverId: string | null,
  tunnelRowId: string,
  connectorToken: string,
): Promise<void> {
  const opId = `cf:ensure:${tunnelRowId}`;
  const token = safeToken(connectorToken);
  const cmd =
    `docker rm -f ${CLOUDFLARED_CONTAINER} >/dev/null 2>&1 || true; ` +
    `docker run -d --name ${CLOUDFLARED_CONTAINER} ` +
    `--restart unless-stopped --network host ` +
    `-e TUNNEL_TOKEN=${shQuote(token)} ` +
    `${CLOUDFLARED_IMAGE} tunnel --no-autoupdate run`;
  const res = await runOnNode(serverId, opId, cmd);
  if (res.code !== 0) {
    throw new Error(`Failed to start cloudflared container: ${res.stderr || res.stdout}`);
  }
}

/** Stop and remove the connector container. Idempotent. */
export async function stopConnector(
  serverId: string | null,
  tunnelRowId: string,
): Promise<void> {
  const res = await runOnNode(
    serverId,
    `cf:stop:${tunnelRowId}`,
    `docker rm -f ${CLOUDFLARED_CONTAINER} >/dev/null 2>&1 || true`,
  );
  if (res.code !== 0) throw new Error(res.stderr || "Failed to stop cloudflared");
}

export type ConnectorStatus = "absent" | "created" | "running" | "paused" | "restarting" | "exited";

/** Docker's view of the connector container ('absent' when it doesn't exist). */
export async function connectorStatus(
  serverId: string | null,
  tunnelRowId: string,
): Promise<ConnectorStatus> {
  const res = await runOnNode(
    serverId,
    `cf:status:${tunnelRowId}`,
    `docker inspect -f '{{.State.Status}}' ${CLOUDFLARED_CONTAINER} 2>/dev/null || echo absent`,
  );
  const out = res.stdout.trim();
  if (["running", "exited", "created", "paused", "restarting"].includes(out)) {
    return out as ConnectorStatus;
  }
  return "absent";
}

/** Recent connector logs (best-effort; used by the Settings panel). */
export async function connectorLogs(
  serverId: string | null,
  tunnelRowId: string,
): Promise<string> {
  const res = await runOnNode(
    serverId,
    `cf:logs:${tunnelRowId}`,
    `docker logs --tail 120 ${CLOUDFLARED_CONTAINER} 2>&1 | tail -c 8000`,
  );
  return res.stdout || res.stderr;
}
