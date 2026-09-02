import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  folders: [] as Array<{ id: string; organizationId: string; name: string; slug: string }>,
  projects: [] as Array<{ id: string; organizationId: string; folderId: string }>,
}));

vi.mock("@repo/db", () => ({
  repos: {
    projectFolder: {
      listByOrganization: async (org: string) => h.folders.filter((f) => f.organizationId === org),
      findByIdInOrganization: async (org: string, id: string) =>
        h.folders.find((f) => f.organizationId === org && f.id === id),
      findBySlugInOrganization: async (org: string, slug: string) =>
        h.folders.find((f) => f.organizationId === org && f.slug === slug),
      create: async (row: { organizationId: string; name: string; slug: string }) => {
        const folder = { id: "folder_1", ...row };
        h.folders.push(folder);
        return folder;
      },
      updateInOrganization: async (_org: string, id: string, patch: Record<string, string>) => {
        const folder = h.folders.find((f) => f.id === id)!;
        Object.assign(folder, patch);
        return folder;
      },
      softDeleteInOrganization: async () => true,
    },
    project: {
      listByFolder: async (org: string, folderId: string) =>
        h.projects.filter((p) => p.organizationId === org && p.folderId === folderId),
    },
  },
}));

import {
  createProjectFolder,
  getProjectFolder,
  listFolderProjects,
} from "./project-folder.service";

describe("project folders", () => {
  beforeEach(() => {
    h.folders.length = 0;
    h.projects.length = 0;
  });

  it("keeps folder lookup and project listing organization-scoped", async () => {
    h.folders.push({ id: "folder_1", organizationId: "org_a", name: "Apps", slug: "apps" });
    h.projects.push({ id: "project_a", organizationId: "org_a", folderId: "folder_1" });

    await expect(getProjectFolder("org_b", "folder_1")).rejects.toThrow();
    await expect(listFolderProjects("org_b", "folder_1")).rejects.toThrow();
    await expect(listFolderProjects("org_a", "folder_1")).resolves.toEqual([
      { id: "project_a", organizationId: "org_a", folderId: "folder_1" },
    ]);
  });

  it("rejects duplicate active folder slugs within one organization", async () => {
    h.folders.push({ id: "folder_1", organizationId: "org_a", name: "Apps", slug: "apps" });
    await expect(createProjectFolder("org_a", { name: "Apps" })).rejects.toThrow("already exists");
    await expect(createProjectFolder("org_b", { name: "Apps" })).resolves.toMatchObject({
      organizationId: "org_b",
      slug: "apps",
    });
  });
});
