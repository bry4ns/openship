import { and, desc, eq, isNull } from "drizzle-orm";
import { generateId } from "@repo/core";
import type { Database } from "../client";
import { projectFolder } from "../schema/project-folder";
import { project } from "../schema/project";

export type ProjectFolder = typeof projectFolder.$inferSelect;
export type NewProjectFolder = typeof projectFolder.$inferInsert;

export function createProjectFolderRepo(db: Database) {
  return {
    async findByIdInOrganization(organizationId: string, id: string) {
      return db.query.projectFolder.findFirst({
        where: and(eq(projectFolder.organizationId, organizationId), eq(projectFolder.id, id), isNull(projectFolder.deletedAt)),
      });
    },
    async findBySlugInOrganization(organizationId: string, slug: string) {
      return db.query.projectFolder.findFirst({
        where: and(eq(projectFolder.organizationId, organizationId), eq(projectFolder.slug, slug), isNull(projectFolder.deletedAt)),
      });
    },
    async listByOrganization(organizationId: string) {
      return db.query.projectFolder.findMany({
        where: and(eq(projectFolder.organizationId, organizationId), isNull(projectFolder.deletedAt)),
        orderBy: [desc(projectFolder.createdAt)],
      });
    },
    async create(data: Omit<NewProjectFolder, "id">) {
      const row = { id: generateId("folder"), ...data };
      await db.insert(projectFolder).values(row);
      return { ...row, createdAt: new Date(), updatedAt: new Date() } as ProjectFolder;
    },
    async updateInOrganization(organizationId: string, id: string, data: Partial<NewProjectFolder>) {
      const [row] = await db.update(projectFolder).set({ ...data, updatedAt: new Date() }).where(
        and(eq(projectFolder.organizationId, organizationId), eq(projectFolder.id, id), isNull(projectFolder.deletedAt)),
      ).returning();
      return row;
    },
    async softDeleteInOrganization(organizationId: string, id: string) {
      return db.transaction(async (tx) => {
        const now = new Date();
        const rows = await tx
          .update(projectFolder)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(projectFolder.organizationId, organizationId),
              eq(projectFolder.id, id),
              isNull(projectFolder.deletedAt),
            ),
          )
          .returning();
        if (rows.length === 0) return false;
        // Soft deletion does not fire the FK's ON DELETE SET NULL action.
        await tx
          .update(project)
          .set({ folderId: null, updatedAt: now })
          .where(
            and(
              eq(project.organizationId, organizationId),
              eq(project.folderId, id),
              isNull(project.deletedAt),
            ),
          );
        return true;
      });
    },
  };
}
