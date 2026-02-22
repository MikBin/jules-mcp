Project: Jules Manager (TypeScript MCP server + Node monitor scripts)
Scope: `jules-mpc-ts/`
Rules: No `.cursor/rules`, `.cursorrules`, `CLAUDE.md`, `.windsurfrules`, `.clinerules`, `.goosehints`, or `.github/copilot-instructions.md` found.
Build/Run:
- Install: `npm install`
- Build: `npm run build`
- Start MCP server: `npm run start` or `node build/mcp-server/jules_mcp_server.js`
- Dev server: `npm run dev`
- Run MCP client: `npm run mcp-client -- <args>`
- Start monitor: `node scripts/jules_monitor.js --config config.json`
- Start watcher: `node scripts/jules_event_watcher.js --command "node scripts/event_handler.js"`
- Tests/lint: none; no single-test command.
Architecture:
- `mcp-server/jules_mcp_server.ts` exposes MCP tools wrapping the Jules API.
- `scripts/jules_monitor.ts` polls the API and appends actionable events to `events.jsonl`.
- `scripts/jules_event_watcher.ts` tails `events.jsonl` and invokes handlers.
- `scripts/event_handler.ts` routes events and calls MCP tools.
- `src/mcp_client.ts` is the CLI MCP client.
- Data files: `config.json`, `jobs.jsonl`, `events.jsonl`, `.monitor_state.json`, `.watcher_state.json`.
Code Style:
- TypeScript ESM (`"type": "module"`); use `import`/`export`.
- Prefer explicit types for public functions and payloads; rely on Zod schemas for validation.
- Naming: camelCase vars/functions, PascalCase types/classes, UPPER_SNAKE_CASE constants.
- Errors: throw `Error` with clear messages; surface API failures with context.
- Keep monitor scripts in `scripts/` as plain Node (no framework).
