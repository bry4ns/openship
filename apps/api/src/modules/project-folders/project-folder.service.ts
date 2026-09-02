import { ConflictError, NotFoundError, slugify } from "@repo/core";
import { repos } from "@repo/db";
import type { TCreateProjectFolderBody, TUpdateProjectFolderBody } from "./project-folder.schema";

function folderSlug(name: string) {
  const slug = slugify(name).slice(0, 63);
  return slug || "folder";
}

export async function listProjectFolders(organizationId: string) {
  const folders = await repos.projectFolder.listByOrganization(organizationId);
  return Promise.all(
    folders.map(async (folder) => ({
      ...folder,
      projectCount: (await repos.project.listByFolder(organizationId, folder.id)).length,
    })),
  );
}

export async function getProjectFolder(organizationId: string, id: string) {
  const folder = await repos.projectFolder.findByIdInOrganization(organizationId, id);
  if (!folder) throw new NotFoundError("Project folder", id);
  return folder;
}

export async function listFolderProjects(organizationId: string, id: string) {
  await getProjectFolder(organizationId, id);
  return repos.project.listByFolder(organizationId, id);
}

export async function createProjectFolder(organizationId: string, data: TCreateProjectFolderBody) {
  const name = data.name.trim();
  const slug = folderSlug(name);
  if (await repos.projectFolder.findBySlugInOrganization(organizationId, slug)) {
    throw new ConflictError(`Project folder "${name}" already exists`);
  }
  return repos.projectFolder.create({ organizationId, name, slug });
}

export async function updateProjectFolder(
  organizationId: string,
  id: string,
  data: TUpdateProjectFolderBody,
) {
  const current = await getProjectFolder(organizationId, id);
  const name = data.name.trim();
  const slug = folderSlug(name);
  const existing = await repos.projectFolder.findBySlugInOrganization(organizationId, slug);
  if (existing && existing.id !== id)
    throw new ConflictError(`Project folder "${name}" already exists`);
  return repos.projectFolder.updateInOrganization(organizationId, current.id, { name, slug });
}

export async function deleteProjectFolder(organizationId: string, id: string) {
  await getProjectFolder(organizationId, id);
  await repos.projectFolder.softDeleteInOrganization(organizationId, id);
}
