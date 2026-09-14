# TODO

## Publish as an npm package (`@srav/mcp-time-server`)

Goal: let anyone add this MCP server with a single `npx` line, no clone/build.

Status: **prepared, not yet published.** Packaging metadata is in place; the
final publish + host-config switch is deferred.

### Already done
- [x] Scoped name `@srav/mcp-time-server`.
- [x] `bin` maps `my-mcp-server -> dist/index.js`; `src/index.ts` has the
      `#!/usr/bin/env node` shebang.
- [x] `files: ["dist"]` so compiled output ships in the tarball.
- [x] `publishConfig.access: "public"` for the scoped package.
- [x] `prepare` builds `dist/` automatically on install/publish.
- [x] Verified tarball contents with `npm pack --dry-run`.

### Remaining
- [ ] `npm login` with an account that owns the `@srav` scope
      (create the org/scope on npmjs.com if it doesn't exist).
- [ ] `npm pack --dry-run` one more time to confirm `dist/index.js` ships.
- [ ] `npm publish` (runs `prepare` -> build -> upload).
- [ ] Bump `version` per change (npm forbids republishing the same version).
- [ ] Switch host config from local path to npx:
      `{ "command": "npx", "args": ["-y", "@srav/mcp-time-server"] }`
      or `claude mcp add --scope user my-first-server -- npx -y @srav/mcp-time-server`.
- [ ] Smoke-test the published package: `npx -y @srav/mcp-time-server` then run
      the raw JSON-RPC handshake against it.

### Later / stretch
- [ ] Add a `LICENSE` file (package.json says ISC).
- [ ] Consider a GitHub Action to publish on tag (`npm publish` with an npm token).
- [ ] Add more tools once the transport story is settled (see transport work).

## Transports
- [x] Notes written up in `docs/transports.md` (incl. 2026-07-28 stateless update).
- [x] Streamable HTTP server (`src/http.ts`, Express, stateless `POST /mcp`).
- [x] Demo client (`src/client.ts`) connecting over Streamable HTTP.
- [x] Tool factored into `src/server.ts`, shared by stdio + HTTP entrypoints.
- [ ] Try connecting Claude Code to the HTTP server:
      `claude mcp add --transport http my-http-server http://localhost:3000/mcp`
- [ ] (Later) add progress/notification streaming to a tool to see SSE in action.
- [ ] (Later) migrate to the stateless spec API once the SDK ships it.
