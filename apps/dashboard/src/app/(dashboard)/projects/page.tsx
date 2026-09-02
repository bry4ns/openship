"use client";

import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
import Link from "next/link";
import { Project } from "@/constants/mock";
import ProjectCard from "./components/ProjectCard";
import ProjectGridCard from "./components/ProjectGridCard";
import { ViewToggle, type ProjectView } from "./components/ViewToggle";
import {
  ProjectFilters,
  buildProjectFilterOptions,
  projectMatchesFilter,
  type ProjectFilter,
} from "./components/ProjectFilters";
import EmptyState from "@/components/overview/EmptyState";
import { ProjectIllustration } from "@/components/overview/ProjectIllustration";
import { projectFoldersApi, projectsApi, type ProjectFolder } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useI18n, interpolate } from "@/components/i18n-provider";
import { Folder, FolderPlus, Plus, Search, Server, X } from "lucide-react";
import { PageContainer } from "@/components/ui/PageContainer";
import { HelpMenu } from "@/components/HelpMenu";
import { usePlatform } from "@/context/PlatformContext";

const VIEW_KEY = "openship-projects-view";

export default function ProjectsPage() {
  const { t } = useI18n();
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>({ kind: "all" });
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<ProjectView>("grid");
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const router = useRouter();
  const { selfHosted } = usePlatform();
  const isLoadingRef = useRef(false);

  /* Remember the chosen view. Read in an effect rather than lazy-initialised
   * state so the server and first client render agree — seeding from
   * localStorage during render would hydrate-mismatch for anyone on grid. */
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "grid" || saved === "list") setView(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    const fetchProjects = async () => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      setIsLoading(true);
      try {
        const [projectResult, folderResult] = await Promise.allSettled([
          projectsApi.getHome(),
          projectFoldersApi.list(),
        ]);
        if (projectResult.status === "fulfilled" && projectResult.value.success && Array.isArray(projectResult.value.projects)) {
          setProjects(projectResult.value.projects);
        }
        if (folderResult.status === "fulfilled") setFolders(folderResult.value.data ?? []);
      } catch (error) {
        console.error("Error fetching projects:", error);
      } finally {
        setIsLoading(false);
        isLoadingRef.current = false;
      }
    };
    fetchProjects();
    return () => { isLoadingRef.current = false; };
  }, []);

  // Target filters derived from the loaded projects (Cloud / each server /
  // Local). Show the filter card once there's more than one group to pick
  // from; the right column also carries a "connect a server" CTA when none of
  // the projects deploy to a server, so it's never empty.
  const filterOptions = useMemo(() => buildProjectFilterOptions(projects, t), [projects, t]);
  const showFilterCard = filterOptions.length > 1;
  const hasServers = projects.some((p) => p.deployTarget === "server");

  const filteredProjects = projects.filter((p) => {
    // Apps (catalog-installed: Convex, webmail, …) live under the Apps tab.
    if (p.isApp) return false;
    if (!projectMatchesFilter(p, filter)) return false;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      p.framework.toLowerCase().includes(q)
    );
  });

  const folderGroups = useMemo(() => {
    const groups = new Map<string | null, Project[]>();
    for (const folder of folders) groups.set(folder.id, []);
    groups.set(null, []);
    for (const project of filteredProjects) {
      const id = project.folderId && groups.has(project.folderId) ? project.folderId : null;
      groups.get(id)!.push(project);
    }
    return [
      ...folders.map((folder) => ({ id: folder.id, name: folder.name, projects: groups.get(folder.id)! })),
      { id: null, name: "Uncategorized", projects: groups.get(null)! },
    ].filter((group) => group.projects.length > 0 || group.id !== null);
  }, [filteredProjects, folders]);

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || isCreatingFolder) return;
    setIsCreatingFolder(true);
    setFolderError(null);
    try {
      const response = await projectFoldersApi.create(name);
      setFolders((current) => [...current, response.data]);
      setFolderName("");
      setShowFolderForm(false);
    } catch {
      setFolderError("Could not create folder");
    } finally {
      setIsCreatingFolder(false);
    }
  }

  return (
    <PageContainer outerClassName="pb-20">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-medium text-foreground/80" style={{ letterSpacing: "-0.2px" }}>
              {t.dashboard.pages.projects.title}
            </h1>
            <p className="text-sm text-muted-foreground/70 mt-1">
              {isLoading
                ? t.projects.list.loading
                : interpolate(
                    projects.length === 1 ? t.projects.list.countOne : t.projects.list.countOther,
                    { count: String(projects.length) },
                  )}
            </p>
          </div>
          {/* Primary action + the shared ⋮ help menu, same as the Apps page. */}
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => { setShowFolderForm((open) => !open); setFolderError(null); }}
              aria-label={showFolderForm ? "Cancel folder creation" : "Create folder"}
              className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {showFolderForm ? <X className="size-4" /> : <FolderPlus className="size-4" />}
              <span className="hidden sm:inline">{showFolderForm ? "Cancel" : "New folder"}</span>
            </button>
            <Link
              href="/library"
              className="inline-flex flex-1 items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 sm:flex-none justify-center"
            >
              <Plus className="size-4" />
              <span>{t.dashboard.pages.projects.createButton}</span>
            </Link>
            <HelpMenu />
          </div>
        </div>

        {showFolderForm && (
          <form onSubmit={createFolder} className="mb-5 flex flex-col gap-2 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4 sm:flex-row sm:items-center">
            <Folder className="hidden size-5 shrink-0 text-primary sm:block" />
            <input
              autoFocus
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Folder name"
              aria-label="Folder name"
              className="min-w-0 flex-1 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
            />
            <button type="submit" disabled={!folderName.trim() || isCreatingFolder} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              {isCreatingFolder ? "Creating..." : "Create folder"}
            </button>
            {folderError && <span className="text-xs text-destructive" role="alert">{folderError}</span>}
          </form>
        )}

        {isLoading ? (
          <div className="bg-card rounded-2xl border border-border/50">
            <div className="divide-y divide-border/50">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                  <div className="w-10 h-10 bg-muted rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded-lg w-32" />
                    <div className="h-3 bg-muted/60 rounded-lg w-48" />
                  </div>
                  <div className="h-6 bg-muted/60 rounded-full w-16" />
                </div>
              ))}
            </div>
          </div>
        ) : projects.length === 0 && folders.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* One grid for toolbar + list + sidebar: the right column spans
                both rows so it starts at the search row's top edge instead of
                below it, while search/toggle stay bounded to the list column. */}
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[1fr_340px]">
              {/* Search on the LEFT, view toggle on the right. Rendered at every
                  project count: hiding it below a threshold left the toggle
                  floating with nothing to anchor it, and the toolbar read as
                  broken rather than intentionally empty. */}
              <div className="flex min-w-0 items-center gap-3 lg:col-start-1 lg:row-start-1">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder={t.dashboard.pages.projects.searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full ps-10 pe-4 py-2.5 bg-card border border-border/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/20 transition-all text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="shrink-0">
                  <ViewToggle value={view} onChange={setView} />
                </div>
              </div>

              {/* Left: project list / empty state for the active search + filter */}
              <div className="min-w-0 lg:col-start-1 lg:row-start-2">
                {filteredProjects.length > 0 || (folders.length > 0 && !searchQuery.trim() && filter.kind === "all") ? (
                  <div className="space-y-7">
                    {folderGroups.map((group) => (
                      <section key={group.id ?? "uncategorized"} className="min-w-0">
                        <div className="mb-3 flex items-center gap-2">
                          <Folder className="size-4 text-primary" />
                          <h2 className="text-sm font-semibold text-foreground">{group.name}</h2>
                          <span className="text-xs text-muted-foreground">{group.projects.length}</span>
                        </div>
                        {group.projects.length > 0 ? (
                          view === "grid" ? (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                              {group.projects.map((project) => <ProjectWithFolder key={project.id} project={project} folders={folders} onAssigned={(folderId) => setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, folderId } : entry))} />)}
                            </div>
                          ) : (
                            <div className="bg-card rounded-2xl border border-border/50 divide-y divide-border/50">
                              {group.projects.map((project) => (
                                <div key={project.id} className="space-y-2 p-1">
                                  <ProjectCard project={project} />
                                  <FolderAssignment project={project} folders={folders} onAssigned={(folderId) => setProjects((current) => current.map((entry) => entry.id === project.id ? { ...entry, folderId } : entry))} />
                                </div>
                              ))}
                            </div>
                          )
                        ) : (
                          <div className="rounded-2xl border border-dashed border-border/60 px-5 py-8 text-center text-sm text-muted-foreground">No projects in this folder yet.</div>
                        )}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[380px] flex-col items-center justify-center px-6 py-12 text-center">
                    <ProjectIllustration className="relative mx-auto mb-6 h-40 w-56" />
                    {searchQuery ? (
                      <p className="mx-auto max-w-sm text-sm text-muted-foreground/70">
                        {t.dashboard.pages.projects.noResultsFound.replace("{query}", searchQuery)}
                      </p>
                    ) : (
                      <>
                        <h3 className="mb-2 text-xl font-medium text-foreground/80" style={{ letterSpacing: "-0.2px" }}>
                          {t.projects.list.noTargetProjects}
                        </h3>
                        {/* No CTA button here — the page header already owns the
                            primary "Create Project" action, and the right card
                            owns "Connect a server". This copy just points to both. */}
                        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground/70">
                          {t.projects.list.noTargetDesc}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Right: filter by deploy target + a server CTA so the column
                  is never empty (e.g. when nothing is deployed to a server). */}
              <div className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-6 lg:self-start">
                {showFilterCard && (
                  <ProjectFilters options={filterOptions} active={filter} onChange={setFilter} />
                )}
                {!hasServers && (
                  <div className="bg-card rounded-2xl border border-border/50 p-5">
                    <div className="w-9 h-9 bg-info-bg rounded-xl flex items-center justify-center mb-3">
                      <Server className="size-[18px] text-info" />
                    </div>
                    <h3 className="font-semibold text-foreground text-sm mb-1">
                      {t.projects.serverCta.title}
                    </h3>
                    <p className="text-xs text-muted-foreground/70 mb-3 leading-relaxed">
                      {t.projects.serverCta.description}
                    </p>
                    {/* SSH servers are a self-hosted/desktop capability — the SaaS
                        can't connect one, so send cloud users to the download page
                        to get the app that can. Self-hosted/desktop use the real flow. */}
                    {selfHosted ? (
                      <Link
                        href="/servers/new"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted/50 text-foreground text-[13px] font-medium transition-colors hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        {t.projects.serverCta.button}
                      </Link>
                    ) : (
                      <a
                        href="https://openship.io/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-muted/50 text-foreground text-[13px] font-medium transition-colors hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        {t.projects.serverCta.button}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
    </PageContainer>
  );
}

function ProjectWithFolder({
  project,
  folders,
  onAssigned,
}: {
  project: Project;
  folders: ProjectFolder[];
  onAssigned: (folderId: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <ProjectGridCard project={project} />
      <FolderAssignment project={project} folders={folders} onAssigned={onAssigned} />
    </div>
  );
}

function FolderAssignment({
  project,
  folders,
  onAssigned,
}: {
  project: Project;
  folders: ProjectFolder[];
  onAssigned: (folderId: string | null) => void;
}) {
  const [updating, setUpdating] = useState(false);

  async function assign(folderId: string | null) {
    const previous = project.folderId ?? null;
    if (folderId === previous) return;
    setUpdating(true);
    onAssigned(folderId);
    try {
      await projectsApi.setFolder(project.id, folderId);
    } catch {
      onAssigned(previous);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <span className="sr-only">Folder for {project.name}</span>
      <Folder className="size-3.5 shrink-0" />
      <select
        value={project.folderId ?? ""}
        disabled={updating}
        onChange={(event) => void assign(event.target.value || null)}
        aria-label={`Folder for ${project.name}`}
        className="min-w-0 flex-1 rounded-lg border border-border/50 bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/40"
      >
        <option value="">Uncategorized</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
      {updating && <span className="shrink-0">Updating...</span>}
    </label>
  );
}
