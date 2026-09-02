# Agent Instructions

## Repository Shape

- This is a Bun monorepo using workspaces under `apps/*` and `packages/*`, orchestrated by Turbo.
- Use Bun `1.3.10` (from the root `package.json`) and Node `>=22`; run `bun install` from the repository root.
- `apps/api` is the Hono control-plane entrypoint (`src/index.ts` -> `src/app.ts`); `apps/dashboard` is the Next.js web UI.
- `packages/db` owns Drizzle schemas, repositories, migrations, and the PGlite test database; do not put persistence logic in app controllers.

## Commands

- `bun run lint` runs Turbo typechecks for non-email packages; Turbo builds dependencies before linting.
- `bun run build` builds only API and dashboard; `bun run build:all` builds every workspace.
- `bun run test` runs non-email tests serially (`--concurrency=1`); use this rather than launching all package tests in parallel.
- Run a focused API test with `bun run --cwd apps/api test -- src/modules/github/repo-list.test.ts`.
- Run a focused dashboard test with `bun run --cwd apps/dashboard test -- src/lib/api/urls.test.ts`.
- Run database tests with `bun run --cwd packages/db test -- <test-file>`; PGlite migrations run per test file and have a 60-second hook budget.
- API end-to-end tests are excluded from the normal suite; run them explicitly with `bun run --cwd apps/api test:e2e` and a working Docker daemon.
- Use Vitest through the package scripts; do not substitute `bun test` for Vitest suites that use `vi.hoisted` or Vitest config.
- Run `bun run --cwd apps/api lint` and `bun run --cwd apps/dashboard lint` when changing only one app; run root lint before merging cross-package changes.

## Runtime And Environment

- API development loads `apps/api/.env` through `node --env-file=.env --import tsx`; dashboard development uses its `scripts/load-env.mjs` loader and `ENV_FILE`.
- Tests need `INTERNAL_TOKEN` when `DEPLOY_MODE` is not desktop; the API Vitest config supplies a test-only value, while production must use a real secret.
- Do not commit `.env` files, tokens, passwords, or generated `dist`/`.next` output.
- `apps/dashboard/next.config.mjs` only enables same-origin API/MCP rewrites when `NEXT_PUBLIC_API_PROXY=true`; self-hosted dashboard builds use `/api/proxy` with `INTERNAL_API_URL`.

## Routing And Authorization

- Declare API routes through `secureRouter`; permission-tagged routes automatically receive `authMiddleware` before permission checks. Do not add a second global auth middleware.
- Controllers that need tenant scope must read `getRequestContext(c)` after auth; do not infer organization scope from arbitrary request bodies or URL strings.
- GitHub authorization is organization-scoped and must resolve the active `providerId` through the accessible-provider repository. Never fall back to an instance-wide GitHub token for an organization project.
- Projects and project apps persist the selected GitHub provider; preserve that provider through prepare, clone, build, redeploy, file access, and webhook paths.
- GitHub webhook routing must be bound by verified project secret, `hook_id`, or GitHub App `installation.id`; `owner/repo` alone is not a tenant boundary.

## Database And Deployment

- Add schema changes in `packages/db/src/schema`, repository access in `packages/db/src/repos`, and a numbered SQL migration under `packages/db/drizzle`; keep the Drizzle journal in sync.
- Use `bun run db:migrate` for existing databases and `bun run db:push` only when the workflow explicitly calls for schema push; API startup can auto-run migrations in deployed self-hosted mode.
- `docker/docker-compose.yml` is the pull-based self-hosted stack with Postgres, Redis, API, dashboard, and edge. The root `docker-compose.yml` is the from-source SaaS/control-plane stack and is not the self-hosted production recipe.
- The self-hosted Postgres Compose service defaults to `PGDATA=/var/lib/postgresql/data/pgdata`; changing this on an existing volume can make Postgres initialize an empty database instead of using the stored cluster.
- Before any deployment change, inspect `git status`, verify the target Compose file and environment, and preserve existing Postgres/Redis volumes.
