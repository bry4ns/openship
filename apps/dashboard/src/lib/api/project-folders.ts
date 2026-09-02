import { api } from "./client";
import { endpoints } from "./endpoints";

export interface ProjectFolder {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  projectCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectFolderProject {
  id: string;
  name: string;
  slug: string;
  folderId?: string | null;
}

export const projectFoldersApi = {
  list: () => api.get<{ data: ProjectFolder[] }>(endpoints.projectFolders.list),
  get: (id: string) => api.get<{ data: ProjectFolder }>(endpoints.projectFolders.item(id)),
  listProjects: (id: string) =>
    api.get<{ data: ProjectFolderProject[] }>(endpoints.projectFolders.projects(id)),
  create: (name: string) =>
    api.post<{ data: ProjectFolder }>(endpoints.projectFolders.create, { name }),
  update: (id: string, name: string) =>
    api.patch<{ data: ProjectFolder }>(endpoints.projectFolders.item(id), { name }),
  remove: (id: string) => api.delete<{ ok: true }>(endpoints.projectFolders.item(id)),
};
