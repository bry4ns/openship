import { Hono } from "hono";
import { secureRouter } from "../../lib/secure-router";
import * as ctrl from "./project-folder.controller";
import { CreateProjectFolderBody, UpdateProjectFolderBody } from "./project-folder.schema";

const r = secureRouter(new Hono(), { module: "project-folders", basePath: "/api/project-folders" });

r.get(
  "/",
  { tag: "project:list", mcp: { description: "List organization folders for projects." } },
  ctrl.list,
);
r.post("/", { tag: "project:write", collection: true, body: CreateProjectFolderBody }, ctrl.create);
r.get("/:id", { tag: "project:read", collection: true }, ctrl.get);
r.get("/:id/projects", { tag: "project:read", collection: true }, ctrl.projects);
r.patch(
  "/:id",
  { tag: "project:write", collection: true, body: UpdateProjectFolderBody },
  ctrl.update,
);
r.delete("/:id", { tag: "project:admin", collection: true }, ctrl.remove);

export const projectFolderRoutes = r.hono;
