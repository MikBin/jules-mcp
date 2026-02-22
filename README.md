# Jules Manager (TypeScript)

An MCP server implementation for orchestrating Google Jules as a remote coding agent from a local coding agent. The system handles the full lifecycle: task decomposition, API-based dispatch to Jules, asynchronous status monitoring, intervention handling, code review, and PR merging.

## Core Principle

**The local agent must not waste context window tokens on active polling.** A decoupled monitoring mechanism handles polling independently and only triggers the local agent when human-level input or a final review is required.

## Quick Start

### Prerequisites

- Node.js 20+
- `JULES_API_KEY` environment variable set with your Jules API key

### Install Dependencies

```bash
npm install
```

### Start the System

```bash
# Terminal 1: Build the TypeScript MCP server
npm run build

# Terminal 2: Start the background monitor
node scripts/jules_monitor.js --config config.json

# Terminal 3: Start the event watcher
node scripts/jules_event_watcher.js --command "node scripts/event_handler.js"
```

### Create a Job

```bash
# Use the MCP client to create a job
npm run mcp-client -- \
  --command node build/mcp-server/jules_mcp_server.js \
  --tool jules_create_job \
  --arguments '{"repo": "owner/repo", "branch": "feature/new-auth", "prompt": "Implement OAuth2 authentication"}'

# Register the job for monitoring
npm run mcp-client -- \
  --command node build/mcp-server/jules_mcp_server.js \
  --tool jules_register_job \
  --arguments '{"job_id": "JOB_ID_FROM_ABOVE", "jobs_path": "jobs.jsonl"}'
```

## Project Structure

```
jules-mcp/
├── README.md                    # This file
├── config.json                  # Shared configuration
├── jobs.jsonl                   # Active jobs registry
├── events.jsonl                 # Actionable event queue
├── docs/
│   └── architecture.md          # Detailed architecture documentation
├── mcp-server/
│   ├── jules_mcp_server.ts      # MCP server implementation
│   └── README.md                # MCP server docs
├── src/
│   └── mcp_client.ts            # CLI MCP client helper
└── scripts/
    ├── jules_monitor.ts         # Background poller
    ├── jules_event_watcher.ts   # Event queue watcher
    └── event_handler.ts         # Event handler
```

## File Descriptions

| File | Purpose |
|------|---------|
| `config.json` | Shared configuration for paths, polling intervals, and API settings |
| `jobs.jsonl` | Registry of active job IDs being monitored (one JSON object per line) |
| `events.jsonl` | Queue of actionable events emitted by the monitor |
| `mcp-server/jules_mcp_server.ts` | MCP server that wraps the Jules API with stdio JSON-RPC |
| `scripts/jules_monitor.ts` | Background daemon that polls Jules API and emits events |
| `scripts/jules_event_watcher.ts` | Tails events.jsonl and invokes handlers for new events |
| `scripts/event_handler.ts` | Routes events to appropriate handlers based on type |
| `src/mcp_client.ts` | CLI tool for calling MCP tools from the command line |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JULES_API_KEY` | Yes | API key for Jules API authentication (from jules.google.com/settings) |
| `JULES_API_BASE` | No | Base URL for Jules API (default: https://jules.googleapis.com/v1alpha) |
| `JULES_CONFIG` | No | Path to config.json (default: config.json) |

## Event Types

| Event | Trigger | Handler Action |
|-------|---------|----------------|
| `question` | Session state = AWAITING_USER_FEEDBACK | Respond via `jules_send_message` |
| `completed` | Session state = COMPLETED | Fetch artifacts, review code, merge PR |
| `error` | Session state = FAILED | Investigate and recreate session |
| `stuck` | No progress for N minutes | Investigate, potentially cancel/restart |

## MCP Tools

The MCP server exposes these tools:

| Tool | Description |
|------|-------------|
| `jules_create_session` | Create a new Jules session |
| `jules_get_session` | Fetch session metadata and status |
| `jules_list_sessions` | List all sessions |
| `jules_delete_session` | Delete a session |
| `jules_send_message` | Send a message to Jules |
| `jules_approve_plan` | Approve a pending plan |
| `jules_list_activities` | List session activities |
| `jules_get_activity` | Get a single activity |
| `jules_list_sources` | List connected repositories |
| `jules_get_source` | Get source details |

## Configuration

See `config.json` for all available settings:

```json
{
  "jobs_path": "jobs.jsonl",
  "events_path": "events.jsonl",
  "monitor_state_path": ".monitor_state.json",
  "watcher_state_path": ".watcher_state.json",
  "monitor_poll_seconds": 45,
  "watcher_poll_seconds": 1,
  "stuck_minutes": 20,
  "api_base": "https://jules.googleapis.com/v1alpha",
  "mcp_command": ["node", "build/mcp-server/jules_mcp_server.js"],
  "event_command": ["node", "scripts/event_handler.js"]
}
```

## Integration with AI Coding Tools

After building the project (`npm run build`), you can use the Jules MCP server with any AI coding tool that supports the MCP stdio protocol.

> **Prerequisites**
> - Run `npm run build` in the project root directory
> - Have your `JULES_API_KEY` ready

---

### Amp (VS Code Extension)

In the Amp settings MCP tab, fill in:

| Field | Value |
|-------|-------|
| **Server Name** | `jules` |
| **Transport** | `stdio` |
| **Command** | `node` |
| **Args** | `build/mcp-server/jules_mcp_server.js` |
| **Cwd** | `/path/to/jules-mcp` |
| **Env** | `JULES_API_KEY` = `<your-token>` |

Or add to `.ampcoderc` / VS Code settings (`amp.mcpServers`):

```json
{
  "mcpServers": {
    "jules": {
      "command": "node",
      "args": ["build/mcp-server/jules_mcp_server.js"],
      "cwd": "/path/to/jules-mcp",
      "env": {
        "JULES_API_KEY": "<your-token>"
      }
    }
  }
}
```

---

### Cline (VS Code Extension)

Add to your `cline_mcp_settings.json` or via the Cline MCP settings UI:

```json
{
  "mcpServers": {
    "jules": {
      "command": "node",
      "args": ["/absolute/path/to/jules-mcp/build/mcp-server/jules_mcp_server.js"],
      "env": {
        "JULES_API_KEY": "<your-token>"
      }
    }
  }
}
```

---

### Kilo Code (VS Code Extension)

Add to `kilo_mcp_settings.json` or via the Kilo Code MCP settings UI:

```json
{
  "mcpServers": {
    "jules": {
      "command": "node",
      "args": ["/absolute/path/to/jules-mcp/build/mcp-server/jules_mcp_server.js"],
      "env": {
        "JULES_API_KEY": "<your-token>"
      }
    }
  }
}
```

---

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "jules": {
      "command": "node",
      "args": ["/absolute/path/to/jules-mcp/build/mcp-server/jules_mcp_server.js"],
      "env": {
        "JULES_API_KEY": "<your-token>"
      }
    }
  }
}
```

---

### Tips

- **Command and args must be separate** — don't put `node script.js` in the command field alone.
- **Use absolute paths** in `args` if the tool doesn't support a `cwd` field.
- **On Windows**, use backslashes in paths (e.g., `D:\\projects\\jules-mcp\\build\\mcp-server\\jules_mcp_server.js`).
- Once connected, all [MCP Tools](#mcp-tools) listed above will be available to the AI agent.

## Architecture

For detailed architecture documentation, see [docs/architecture.md](docs/architecture.md).

## Dependencies

This project uses the TypeScript MCP SDK (`@modelcontextprotocol/sdk`) and Zod for schemas. The monitoring scripts are plain Node.js and do not require additional packages.

## Troubleshooting

Common issues and their solutions:

1. If the server fails to start, check that the `JULES_API_KEY` environment variable is set correctly.
2. If you get connection errors, verify your network can reach the Jules API endpoints.