"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, Folder, Search, Server, TriangleAlert } from "lucide-react";
import { PageContainer } from "@/components/ui/PageContainer";
import { getProjectStatus } from "@/utils/project-status";
import ProjectGridCard from "../projects/components/ProjectGridCard";
import type { ReactNode } from "react";
import { filterFleet, groupFleet, groupProjectsByFolder, loadFleet, type FleetProject } from "./fleet-adapter";
import type { ProjectFolder } from "@/lib/api";
import { projectsApi } from "@/lib/api";

export default function FleetPage() {
  const copy = {
    title: "Infrastructure fleet",
    subtitle: "See every project grouped by its deployment target.",
    backToProjects: "Back to projects",
    search: "Search projects, domains, or repositories",
    allTargets: "All targets",
    projects: "Projects",
    healthy: "Ready",
    attention: "Needs attention",
    cloud: "Openship Cloud",
    local: "Local machine",
    noResults: "No projects match this view.",
    uncategorized: "Uncategorized",
    folder: "Folder",
    updating: "Updating folder",
  };
  const [projects, setProjects] = useState<FleetProject[]>([]);
  const [servers, setServers] = useState<Awaited<ReturnType<typeof loadFleet>>["servers"]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadFleet()
      .then((result) => {
        if (!cancelled) {
          setProjects(result.projects);
          setServers(result.servers);
          setFolders(result.folders);
        }
      })
      .catch((error) => console.error("Error fetching fleet projects:", error))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const targets = useMemo(() => groupFleet(projects, servers, copy.cloud, copy.local), [copy.cloud, copy.local, projects, servers]);

  const visibleTargets = useMemo(() => filterFleet(targets, query, target), [query, target, targets]);

  const readyCount = projects.filter((project) => getProjectStatus(project) === "live").length;
  const attentionCount = projects.length - readyCount;

  return (
    <PageContainer outerClassName="pb-20">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/projects" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
            {copy.backToProjects}
          </Link>
          <h1 className="text-2xl font-medium tracking-tight text-foreground">{copy.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
          <Summary icon={<Server className="size-4" />} value={projects.length} label={copy.projects} />
          <Summary icon={<CheckCircle2 className="size-4 text-success" />} value={readyCount} label={copy.healthy} />
          <Summary icon={<TriangleAlert className="size-4 text-warning" />} value={attentionCount} label={copy.attention} />
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search}
            className="w-full rounded-xl border border-border/50 bg-card py-2.5 pe-4 ps-10 text-sm text-foreground outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
          />
        </div>
        <div className="relative shrink-0">
        <select
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          aria-label={copy.allTargets}
          className="w-full appearance-none rounded-xl border border-border/50 bg-card py-2.5 pe-9 ps-3 text-sm text-foreground outline-none focus:border-primary/40 sm:w-auto"
        >
          <option value="all">{copy.allTargets}</option>
          {targets.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select><ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl bg-muted/50" />)}
        </div>
      ) : visibleTargets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 px-6 py-20 text-center text-sm text-muted-foreground">{copy.noResults}</div>
      ) : (
        <div className="space-y-8">
          {visibleTargets.map((item) => (
            <section key={item.key} className="min-w-0">
              <div className="mb-3 flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Server className="size-4" /></div>
                <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-foreground">{item.label}</h2><p className="truncate text-xs text-muted-foreground">{item.kind === "server" ? item.host : item.kind === "cloud" ? "Managed deployment target" : "This device"} · {item.projects.length} {copy.projects.toLowerCase()}</p></div>
              </div>
               <div className="space-y-5">
                 {groupProjectsByFolder(item.projects, folders).map((group) => (
                   <div key={group.id ?? "uncategorized"}>
                     <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                       <Folder className="size-3.5" />
                       <span>{group.id === null ? copy.uncategorized : group.name}</span>
                       <span className="text-muted-foreground/60">{group.projects.length}</span>
                     </div>
                     <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                       {group.projects.map((project) => (
                         <div key={project.id} className="space-y-2">
                           <ProjectGridCard project={project} />
                           <FolderSelect
                             project={project}
                             folders={folders}
                             label={copy.folder}
                             updatingLabel={copy.updating}
                             onAssigned={(folderId) => setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, folderId } : entry))}
                           />
                         </div>
                       ))}
                     </div>
                   </div>
                 ))}
               </div>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function FolderSelect({
  project,
  folders,
  label,
  updatingLabel,
  onAssigned,
}: {
  project: FleetProject;
  folders: ProjectFolder[];
  label: string;
  updatingLabel: string;
  onAssigned: (folderId: string | null) => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(false);

  async function assign(folderId: string | null) {
    const previous = project.folderId ?? null;
    if (folderId === previous) return;
    setUpdating(true);
    setError(false);
    onAssigned(folderId);
    try {
      await projectsApi.setFolder(project.id, folderId);
    } catch {
      onAssigned(previous);
      setError(true);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <span className="sr-only">{label} for {project.name}</span>
      <Folder className="size-3.5 shrink-0" />
      <select
        value={project.folderId ?? ""}
        disabled={updating}
        onChange={(event) => void assign(event.target.value || null)}
        aria-label={`${label} for ${project.name}`}
        className="min-w-0 flex-1 rounded-lg border border-border/50 bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
      >
        <option value="">Uncategorized</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
      {updating && <span className="shrink-0">{updatingLabel}</span>}
      {error && <span className="shrink-0 text-destructive" role="alert">Could not update</span>}
    </label>
  );
}

function Summary({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return <div className="rounded-2xl border border-border/50 bg-card px-3 py-3"><div className="mb-1 flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-[11px]">{label}</span></div><strong className="text-xl font-medium text-foreground">{value}</strong></div>;
}
