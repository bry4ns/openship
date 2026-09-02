import type { Context } from "hono";
import { getRequestContext } from "../../lib/request-context";
import * as service from "./project-folder.service";
import type { TCreateProjectFolderBody, TUpdateProjectFolderBody } from "./project-folder.schema";

export async function list(c: Context) {
  return c.json({ data: await service.listProjectFolders(getRequestContext(c).organizationId) });
}

export async function get(c: Context) {
  const ctx = getRequestContext(c);
  const id = c.req.param("id") ?? "";
  return c.json({ data: await service.getProjectFolder(ctx.organizationId, id) });
}

export async function projects(c: Context) {
  const ctx = getRequestContext(c);
  return c.json({
    data: await service.listFolderProjects(ctx.organizationId, c.req.param("id") ?? ""),
  });
}

export async function create(c: Context) {
  const ctx = getRequestContext(c);
  const body = await c.req.json<TCreateProjectFolderBody>();
  return c.json({ data: await service.createProjectFolder(ctx.organizationId, body) }, 201);
}

export async function update(c: Context) {
  const ctx = getRequestContext(c);
  const body = await c.req.json<TUpdateProjectFolderBody>();
  return c.json({
    data: await service.updateProjectFolder(ctx.organizationId, c.req.param("id") ?? "", body),
  });
}

export async function remove(c: Context) {
  const ctx = getRequestContext(c);
  await service.deleteProjectFolder(ctx.organizationId, c.req.param("id") ?? "");
  return c.json({ ok: true });
}
