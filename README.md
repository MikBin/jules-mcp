# Jules Manager (TypeScript) (Server Version 2.0.0)

An MCP server implementation for orchestrating Google Jules as a remote coding agent from a local coding agent. The system handles the full lifecycle: task decomposition, API-based dispatch to Jules, asynchronous status monitoring, intervention handling, code review, and PR merging.

## Core Principle

**The local agent must not waste context window tokens on active polling.** A decoupled monitoring mechanism handles polling independently and only triggers the local agent when human-level input or a final review is required.

Background monitor enforcement: periodic polling in `scripts/jules_monitor.ts` is hard-wired to call only `jules_check_jules` (compact `Q/C/F/N` responses). The monitor does not call `jules_get_session` during polling. Detailed session retrieval is reserved for follow-up handling after actionable events.

## Overview

The Jules MCP server acts as a bridge between a local coding environment and the Google Jules API. It enables you to:
1. Create and manage Jules coding sessions directly from your development environment.
2. Monitor session progress automatically in the background.
3. Handle requests for human input (like plan approvals or clarifications) using event watchers.
4. Extract pull request information directly from completed sessions.

## Quick Start / Installation

### Prerequisites

- Node.js 20+
- `JULES_API_KEY` environment variable set with your Jules API key

### Install Dependencies

```bash
npm install
```

### Start the System

The system is composed of three running processes for full functionality:

```bash
# Terminal 1: Build the TypeScript project
npm run build

# Terminal 2: Start the background monitor
node build/scripts/jules_monitor.js --config config.json

# Terminal 3: Start the event watcher
node build/scripts/jules_event_watcher.js --command "node build/scripts/event_handler.js"
```

## CLI Usage

### jules_cli (Friendly CLI)

The easiest way to interact with Jules from the command line is the `jules_cli` wrapper:

```bash
npm run jules -- <command> [options]
```

**Commands:**

| Command   | Description                              | Options |
|-----------|------------------------------------------|---------|
| `create`  | Create a new Jules session               | `--owner`, `--repo`, `--branch`, `--prompt`, `--title`, `--require-approval`, `--automation-mode` |
| `get`     | Get session details                      | `--session-id` |
| `list`    | List all sessions                        | *(none)* |
| `approve` | Approve a session's plan                 | `--session-id` |
| `monitor` | Poll a session until it completes/fails  | `--session-id`, `--interval` (seconds, default 120) |

**Examples:**

```bash
# Create a session
npm run jules -- create --owner my-org --repo my-repo --branch main --prompt "Refactor the login module"

# List sessions
npm run jules -- list

# Get a specific session
npm run jules -- get --session-id 12345

# Approve a plan
npm run jules -- approve --session-id 12345

# Monitor a session (polls every 60s)
npm run jules -- monitor --session-id 12345 --interval 60
```

### mcp-client (Raw MCP Tool Invocation)

For direct MCP tool calls (useful for scripting or debugging), use the generic MCP client:

```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool <TOOL_NAME> --arguments '<JSON_ARGUMENTS>'
```

## MCP Tools

The Jules MCP server exposes the following 13 tools to manage the lifecycle of Jules sessions.

### `jules_create_session`
Create a new Jules coding session for a GitHub repository.

**Parameters:**
- `owner` (string, required): GitHub repository owner.
- `repo` (string, required): GitHub repository name.
- `branch` (string, required): Starting branch name.
- `prompt` (string, required): Task description for Jules.
- `title` (string, optional): Optional session title.
- `requirePlanApproval` (boolean, optional): Whether to require plan approval before execution.
- `automationMode` (string, optional): Automation mode. Defaults to `"AUTO_CREATE_PR"` (Jules automatically publishes a pull request upon successful completion). Passing an empty string or alternative mode will override this.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_create_session --arguments '{"owner": "my-org", "repo": "my-repo", "branch": "main", "prompt": "Refactor the login module", "requirePlanApproval": true}'
```

### `jules_get_session`
Fetch session metadata, state, and outputs.

**Parameters:**
- `session_id` (string, required): The Jules session ID.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_get_session --arguments '{"session_id": "sessions/12345"}'
```

### `jules_check_jules`
Token-saving status check intended for periodic polling. Returns a one-character code to minimize response size and context usage:
- `Q`: session needs clarification/approval (`AWAITING_USER_FEEDBACK` or `AWAITING_PLAN_APPROVAL`)
- `C`: session completed
- `F`: session failed
- `N`: no action required (in progress, unknown, or no session found)

You can provide either a specific `session_id`, or `owner` + `repo` (optionally `branch`) to resolve the latest session for the current project.

**Parameters:**
- `session_id` (string, optional): Specific session to check.
- `owner` (string, optional): GitHub repository owner (required when `session_id` is not provided).
- `repo` (string, optional): GitHub repository name (required when `session_id` is not provided).
- `branch` (string, optional): Optional branch filter when checking by project.

**Usage Example (project-scoped):**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_check_jules --arguments '{"owner": "mikbin", "repo": "jules-mcp", "branch": "main"}'
```

**Usage Example (session-scoped):**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_check_jules --arguments '{"session_id": "sessions/12345"}'
```

### `jules_list_sessions`
List Jules sessions.

**Parameters:**
- `pageSize` (number, optional): Maximum number of sessions to return.
- `pageToken` (string, optional): Page token for pagination.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_list_sessions --arguments '{"pageSize": 10}'
```

### `jules_delete_session`
Delete a Jules session.

**Parameters:**
- `session_id` (string, required): The Jules session ID.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_delete_session --arguments '{"session_id": "sessions/12345"}'
```

### `jules_send_message`
Send a clarification or instruction to a Jules session.

**Parameters:**
- `session_id` (string, required): The Jules session ID.
- `message` (string, required): Message text to send.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_send_message --arguments '{"session_id": "sessions/12345", "message": "Please make sure to also update the unit tests."}'
```

### `jules_approve_plan`
Approve the plan for a session awaiting plan approval.

**Parameters:**
- `session_id` (string, required): The Jules session ID.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_approve_plan --arguments '{"session_id": "sessions/12345"}'
```

### `jules_list_activities`
List activities for a Jules session.

**Parameters:**
- `session_id` (string, required): The Jules session ID.
- `pageSize` (number, optional): Maximum number of activities to return.
- `pageToken` (string, optional): Page token for pagination.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_list_activities --arguments '{"session_id": "sessions/12345", "pageSize": 5}'
```

### `jules_get_activity`
Get a single activity by ID for a Jules session.

**Parameters:**
- `session_id` (string, required): The Jules session ID.
- `activity_id` (string, required): The activity ID.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_get_activity --arguments '{"session_id": "sessions/12345", "activity_id": "activities/67890"}'
```

### `jules_list_sources`
List available sources (GitHub repositories).

**Parameters:**
- `pageSize` (number, optional): Maximum number of sources to return.
- `pageToken` (string, optional): Page token for pagination.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_list_sources --arguments '{}'
```

### `jules_get_source`
Get details for a specific source.

**Parameters:**
- `source_id` (string, required): The source ID.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_get_source --arguments '{"source_id": "sources/github/my-org/my-repo"}'
```

### `jules_extract_pr_from_session`
Extract pull request information from a completed Jules session outputs.

**Parameters:**
- `session_id` (string, required): The completed Jules session ID.

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_extract_pr_from_session --arguments '{"session_id": "sessions/12345"}'
```


### `jules_monitor_session`
Monitor a Jules session with real-time MCP progress notifications. Polls the session until it reaches a terminal state (`COMPLETED` or `FAILED`), sending `notifications/progress` messages back to the client with the latest activity description. If the session enters `AWAITING_USER_FEEDBACK`, the tool returns early so the caller can respond with `jules_approve_plan` or `jules_send_message` and then resume monitoring.

**Parameters:**
- `session_id` (string, required): The Jules session ID to monitor.
- `poll_interval_seconds` (number, optional): Polling interval in seconds (default: 60, max: 300).

**Usage Example:**
```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool jules_monitor_session --arguments '{"session_id": "sessions/12345", "poll_interval_seconds": 10}'
```

> **Note:** Progress notifications require a client that supports the MCP `notifications/progress` method (most MCP-compatible IDEs do). The notifications include a `message` field with the current session state and latest activity description, allowing the client to display real-time status updates without consuming additional context window tokens.

## Configuration & Environment Variables

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JULES_API_KEY` | No* | API key for Jules API authentication. |
| `JULES_API_BASE` | No | Base URL for Jules API (default: https://jules.googleapis.com/v1alpha) |
| `JULES_CONFIG` | No | Path to config.json (default: config.json) |

*\*Required if not provided via `mcp_config.json`.*

### MCP Configuration File (Recommended)

Jules MCP can automatically discover your API key from standard MCP configuration files used by tools like Antigravity or Cline. It looks for the `JULES_API_KEY` in the `env` section of the `jules-mcp-server` entry in:
- `~/.gemini/antigravity/mcp_config.json`
- `~/.cline/mcp_config.json`

Example `mcp_config.json` entry:
```json
{
  "mcpServers": {
    "jules-mcp-server": {
      "command": "node",
      "args": ["/path/to/jules-mcp/build/mcp-server/jules_mcp_server.js"],
      "env": {
        "JULES_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### JSON Configuration

Shared configuration for the background processes is stored in `config.json`. See the file for all available settings:

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
  "event_command": ["node", "build/scripts/event_handler.js"],
  "auto_approve_plans": false
}
```

**Configuration Details:**
- `auto_approve_plans` (boolean): If `true`, the `event_handler` will automatically call `jules_approve_plan` whenever a session enters the `AWAITING_USER_FEEDBACK` state for a plan approval.
- `mcp_command` (string[]): Required by `jules_monitor`. The monitor uses this command to invoke MCP tool `jules_check_jules` for all periodic polling checks.


## Testing

Run the test suite with [Vitest](https://vitest.dev/):

```bash
npm test
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
│   ├── mcp_client.ts            # Generic MCP client (raw tool invocation)
│   └── utils.ts                 # Shared utilities (e.g. formatTimestamp)
├── scripts/
│   ├── jules_cli.ts             # Friendly CLI wrapper (npm run jules)
│   ├── jules_monitor.ts         # Background poller
│   ├── jules_event_watcher.ts   # Event queue watcher
│   └── event_handler.ts         # Event handler
└── tests/
    ├── mcp_server.test.ts       # MCP server tests
    ├── monitor.test.ts          # Monitor tests
    ├── event_handler.test.ts    # Event handler tests
    └── utils.test.ts            # Utility tests
```

## Integration with AI Coding Tools

After building the project (`npm run build`), you can use the Jules MCP server with any AI coding tool that supports the MCP stdio protocol (such as Amp, Cline, Kilo Code, Windsurf, etc.). 

For AI agents and easier discovery, see [llms-installation.md](./llms-installation.md).

> **Prerequisites**
> - Run `npm run build` in the project root directory
> - Have your `JULES_API_KEY` ready

Configure the server with standard stdio transport:
- **Command**: `node`
- **Args**: `/absolute/path/to/jules-mcp/build/mcp-server/jules_mcp_server.js`
- **Env**: `JULES_API_KEY` = `<your-token>`

## Agent Discovery & API Visibility

When the Jules MCP server is installed as an MCP server for tools such as **Cline**, **Kilo Code**, **Amp**, or **Windsurf**, those agents do **not** embed any Jules API credentials. Instead they:

* Look for a standard MCP configuration file (`~/.gemini/antigravity/mcp_config.json` or `~/.cline/mcp_config.json`).  
* If the file contains an entry for `jules-mcp-server`, the `env` section is merged into the process environment, exposing `JULES_API_KEY` and optionally `JULES_API_BASE`.  
* If no config file is found, the agents fall back to the environment variables `JULES_API_KEY` / `JULES_API_BASE` that you export in your shell before launching the server.

Because the credentials are supplied **at runtime**, they are never baked into the production bundle (`build/…`). The bundle only contains the compiled JavaScript code that talks to the Jules API; the actual API key lives outside the repository and is therefore safe to share the built artifact without leaking secrets.

### Visibility

* **Inside the repository** – the README and `config.json` document the required environment variables and the optional `auto_approve_plans` flag.
* **Outside the repository** – any process that runs the MCP server (including third‑party agents) can discover the credentials via the MCP config mechanism described above. No additional network request is needed; the key is read locally before the server starts.

This design ensures that the API information is **discoverable by any MCP‑compatible client** while remaining **private** to the host environment.
