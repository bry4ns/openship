import type { Project } from "@/constants/mock";
import { projectFoldersApi, projectsApi, systemApi } from "@/lib/api";
import type { ProjectFolder } from "@/lib/api";
import type { ServerInfo } from "@/lib/api/system";

export type FleetProject = Project & { primaryDomain?: string | null };

export type FleetNode = {
  key: string;
  label: string;
  kind: "server" | "cloud" | "local";
  host?: string;
  projects: FleetProject[];
};

/** Keep API knowledge at the page boundary so grouping stays easy to test. */
export async function loadFleet(): Promise<{ projects: FleetProject[]; servers: ServerInfo[]; folders: ProjectFolder[] }> {
  const [projectResult, serverResult, folderResult] = await Promise.allSettled([
    projectsApi.getHome(),
    systemApi.listServers(),
    projectFoldersApi.list(),
  ]);

  if (projectResult.status === "rejected") throw projectResult.reason;

  return {
    projects: (projectResult.value.projects ?? []).filter((project) => !project.isApp) as FleetProject[],
    // Server inventory is self-hosted-only; project data remains useful when
    // this endpoint is unavailable in Cloud mode or on older instances.
    servers: serverResult.status === "fulfilled" ? serverResult.value ?? [] : [],
    // Folders are additive to the fleet view. A missing/unsupported endpoint
    // must not make the existing project list disappear.
    folders: folderResult.status === "fulfilled" ? folderResult.value.data ?? [] : [],
  };
}

export function groupProjectsByFolder(projects: FleetProject[], folders: ProjectFolder[]) {
  const names = new Map(folders.map((folder) => [folder.id, folder.name]));
  const groups = new Map<string, { id: string | null; name: string; projects: FleetProject[] }>();
  for (const project of projects) {
    const id = project.folderId ?? null;
    const name = id ? names.get(id) ?? "Unknown folder" : "Uncategorized";
    const group = groups.get(id ?? "__uncategorized__") ?? { id, name, projects: [] };
    group.projects.push(project);
    groups.set(id ?? "__uncategorized__", group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return a.name.localeCompare(b.name);
  });
}

export function groupFleet(projects: FleetProject[], servers: ServerInfo[], cloudLabel: string, localLabel: string) {
  const nodes = new Map<string, FleetNode>();
  const add = (node: FleetNode) => {
    const existing = nodes.get(node.key);
    if (existing) return existing;
    nodes.set(node.key, node);
    return node;
  };

  for (const server of servers) {
    add({
      key: `server:${server.id}`,
      label: server.name || server.sshHost || "VPS node",
      host: server.sshHost,
      kind: "server",
      projects: [],
    });
  }

  for (const project of projects) {
    const key = project.deployTarget === "cloud"
      ? "cloud"
      : project.deployTarget === "local" || project.localPath
        ? "local"
        : `server:${project.serverId || "unknown"}`;
    const node = add({
      key,
      label: key === "cloud" ? cloudLabel : key === "local" ? localLabel : project.serverName || "VPS node",
      kind: key === "cloud" ? "cloud" : key === "local" ? "local" : "server",
      projects: [],
    });
    node.projects.push(project);
  }

  return [...nodes.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "server" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export function filterFleet(nodes: FleetNode[], query: string, selectedKey: string) {
  const normalized = query.trim().toLowerCase();
  return nodes
    .filter((node) => selectedKey === "all" || node.key === selectedKey)
    .map((node) => ({
      ...node,
      projects: node.projects.filter((project) => !normalized || [
        project.name, project.slug, project.primaryDomain, project.gitOwner, project.gitRepo, project.serverName,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized))),
    }))
    .filter((node) => node.projects.length > 0 || (!normalized && node.kind === "server"));
}
