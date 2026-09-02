import { describe, expect, it } from "vitest";
import type { Project } from "@/constants/mock";
import { filterFleet, groupFleet, groupProjectsByFolder } from "./fleet-adapter";
import type { ProjectFolder } from "@/lib/api";

const project = (over: Partial<Project>): Project => ({
  id: over.id || "p1", name: over.name || "App", slug: over.slug || "app", framework: "static",
  deployTarget: "server", serverId: "s1", serverName: "edge-1", ...over,
} as Project);

describe("fleet grouping", () => {
  it("keeps empty registered VPS nodes visible and groups projects by id", () => {
    const nodes = groupFleet([project({})], [
      { id: "s1", name: "edge-1", sshHost: "10.0.0.1", isLocal: false } as never,
      { id: "s2", name: "empty-2", sshHost: "10.0.0.2", isLocal: false } as never,
    ], "Cloud", "Local");
    expect(nodes.map((node) => [node.key, node.projects.length])).toEqual([["server:s1", 1], ["server:s2", 0]]);
  });

  it("searches project metadata and retains only matching nodes", () => {
    const nodes = groupFleet([project({ id: "a", name: "Store", gitRepo: "shop" }), project({ id: "b", name: "Docs", serverId: "s2", serverName: "edge-2" })], [], "Cloud", "Local");
    expect(filterFleet(nodes, "shop", "all").map((node) => node.key)).toEqual(["server:s1"]);
    expect(filterFleet(nodes, "", "server:s2")[0]?.projects).toHaveLength(1);
  });

  it("groups projects by folder within a deployment node, with uncategorized last", () => {
    const folders = [
      { id: "f1", name: "Product", slug: "product", projectCount: 1 },
      { id: "f2", name: "Operations", slug: "operations", projectCount: 1 },
    ] as ProjectFolder[];
    const groups = groupProjectsByFolder([
      project({ id: "p1", folderId: "f1" }),
      project({ id: "p2", folderId: null }),
      project({ id: "p3", folderId: "f2" }),
    ], folders);

    expect(groups.map((group) => [group.name, group.projects.map((item) => item.id)])).toEqual([
      ["Operations", ["p3"]],
      ["Product", ["p1"]],
      ["Uncategorized", ["p2"]],
    ]);
  });

  it("keeps projects with a deleted folder visible", () => {
    const groups = groupProjectsByFolder([project({ folderId: "missing" })], []);
    expect(groups[0]?.name).toBe("Unknown folder");
    expect(groups[0]?.projects[0]?.id).toBe("p1");
  });
});
