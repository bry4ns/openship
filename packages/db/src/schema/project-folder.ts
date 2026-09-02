import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./organization";

/** Flat, organization-owned grouping for projects. */
export const projectFolder = pgTable(
  "project_folder",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_project_folder_org_slug_active")
      .on(table.organizationId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_project_folder_org").on(table.organizationId),
  ],
);
