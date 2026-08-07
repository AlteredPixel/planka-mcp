# Planka MCP Server — Agent Instructions

## Quick start

```bash
npm install && npm run build          # TypeScript → dist/
npm test                              # Integration tests (requires running Planka server)
npm run inspector                     # MCP protocol inspector for debugging tools
```

## Architecture

| File | Role |
|---|---|
| `index.ts` | Stdio transport — primary entry point (`dist/index.js`, declared in `bin`) |
| `http-server.ts` | Streamable-HTTP transport (official MCP SDK) — used by Docker image and health checks. Bearer-token protected. |
| `common/registerTools.ts` | Single source of truth for the 9 tool definitions; `registerTools(server)` is shared by both transports |
| `operations/*.ts` | Low-level Planka API wrappers (boards, cards, lists, tasks, labels, comments, memberships, projects) |
| `tools/*.ts` | Higher-level composite tools exported via `tools/index.ts` |
| `common/utils.ts` | Shared HTTP client with Bearer-token auth **to Planka**; token cached globally per process (unrelated to the MCP client token below) |

The MCP server exposes 9 consolidated tools (e.g. `mcp_kanban_card_manager`) that multiplex actions via a Zod-validated `action` enum. Tool definitions live only in `common/registerTools.ts` — both `index.ts` and `http-server.ts` call `registerTools()`, so add new actions in one place.

## HTTP transport & auth

`http-server.ts` uses the SDK's `StreamableHTTPServerTransport` (stateful, session keyed by the `Mcp-Session-Id` header):
- `POST /mcp` — JSON-RPC requests (`initialize` opens a session)
- `GET /mcp` — server→client SSE stream for an established session
- `DELETE /mcp` — end a session
- `GET /health` — unauthenticated probe

All `/mcp` requests require `Authorization: Bearer <PLANKA_MCP_TOKEN>`. **Closed by default**: if `PLANKA_MCP_TOKEN` is unset, `/mcp` rejects every request with 401. Clients (e.g. LibreChat) must use transport type **streamable-http** pointed at the full `/mcp` URL.

## Environment variables

Copy `.env` from `example.env`. Required at runtime:
- `PLANKA_BASE_URL` — Planka API base (default `http://localhost:3000`)
- `PLANKA_AGENT_EMAIL` / `PLANKA_AGENT_PASSWORD` — credentials for the MCP agent user
- `PLANKA_ADMIN_EMAIL` or `PLANKA_ADMIN_USERNAME` — admin identity for membership operations
- `PLANKA_MCP_TOKEN` — bearer token clients must present to the HTTP `/mcp` endpoint. **Required for the HTTP server**: if unset, `/mcp` is disabled. Not used by the stdio entry point.
- `PLANKA_MCP_PORT` — HTTP server listen port (default `3008`)

The `.env` file is gitignored. The docker-compose flow reads it via `--env-file .env`.

## Testing

Tests are **integration-only** against a live Planka instance. The setup file (`.jest/setEnvVars.js`) probes the server before any test runs and exits with code 1 if unreachable. You must have a running Planka server at `PLANKA_BASE_URL` before running tests.

```bash
npm test                              # Run integration tests (requires live Planka)
```

Test timeout is 5 minutes (`jest.setTimeout(300000)`). Tests create timestamped resources and clean them up in `afterAll`.

## Docker

The Dockerfile builds the HTTP server entry point (`dist/http-server.js`). The health check hits `/health` on port 3008.

```bash
npm run build-docker                  # Build TS + docker image
docker compose --env-file .env up -d  # Start only the MCP server (NOT Planka or Postgres)
```

Note: `docker-compose.yml` defines **only** the `planka-mcp` service. It does NOT include Planka or Postgres — you need a separate Planka deployment for it to connect to. The README's claim that `npm run up` starts "Planka containers" is misleading; it only starts the MCP server container.

## Package manager quirks

Both `package-lock.json` and `pnpm-lock.yaml` exist. The Dockerfile uses pnpm. For local development, either works; prefer npm to match the lockfile used by most scripts.

## Missing script

The README references `npm run qc` (lint + typecheck) but no such script exists in `package.json`. To verify types manually: `npx tsc --noEmit`. There is no linter configured.
