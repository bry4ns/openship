CREATE TABLE "project_folder" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "folder_id" text;
--> statement-breakpoint
ALTER TABLE "project_folder" ADD CONSTRAINT "project_folder_organization_id_organization_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_folder_id_project_folder_id_fk"
  FOREIGN KEY ("folder_id") REFERENCES "public"."project_folder"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_folder_org_slug_active" ON "project_folder" USING btree ("organization_id", "slug") WHERE "project_folder"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "idx_project_folder_org" ON "project_folder" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "idx_project_folder_project" ON "project" USING btree ("folder_id");
