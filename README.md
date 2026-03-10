# Jules Manager (TypeScript) (Server Version 2.0.0)

An MCP server implementation for orchestrating Google Jules as a remote coding agent from a local coding agent. The system handles the full lifecycle: task decomposition, API-based dispatch to Jules, asynchronous status monitoring, intervention handling, code review, and PR merging.

## Core Principle

**The local agent must not waste context window tokens on active polling.** A decoupled monitoring mechanism handles polling independently and only triggers the local agent when human-level input or a final review is required.

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
# Terminal 1: Build the TypeScript MCP server
npm run build

# Terminal 2: Start the background monitor
node scripts/jules_monitor.js --config config.json

# Terminal 3: Start the event watcher
node scripts/jules_event_watcher.js --command "node scripts/event_handler.js"
```

## CLI Usage (jules_cli)

You can interact with the Jules MCP Server directly from the command line using `jules_cli`. Since the CLI tool internally invokes the built MCP server via `src/mcp_client.ts`, you execute tools like so:

```bash
npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js --tool <TOOL_NAME> --arguments '<JSON_ARGUMENTS>'
```

*(Note: If a global `jules_cli` executable is available in your environment, replace the `npm run mcp-client -- --command node build/mcp-server/jules_mcp_server.js` portion with `jules_cli`)*

## MCP Tools

The Jules MCP server exposes the following 11 tools to manage the lifecycle of Jules sessions.

### `jules_create_session`
Create a new Jules coding session for a GitHub repository.

**Parameters:**
- `owner` (string, required): GitHub repository owner.
- `repo` (string, required): GitHub repository name.
- `branch` (string, required): Starting branch name.
- `prompt` (string, required): Task description for Jules.
- `title` (string, optional): Optional session title.
- `requirePlanApproval` (boolean, optional): Whether to require plan approval before execution.
- `automationMode` (string, optional): Automation mode, e.g. "AUTO_CREATE_PR".

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


## Configuration & Environment Variables

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JULES_API_KEY` | Yes | API key for Jules API authentication (from jules.google.com/settings) |
| `JULES_API_BASE` | No | Base URL for Jules API (default: https://jules.googleapis.com/v1alpha) |
| `JULES_CONFIG` | No | Path to config.json (default: config.json) |

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
  "event_command": ["node", "scripts/event_handler.js"]
}
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

## Integration with AI Coding Tools

After building the project (`npm run build`), you can use the Jules MCP server with any AI coding tool that supports the MCP stdio protocol (such as Amp, Cline, Kilo Code, Windsurf, etc.).

> **Prerequisites**
> - Run `npm run build` in the project root directory
> - Have your `JULES_API_KEY` ready

Configure the server with standard stdio transport:
- **Command**: `node`
- **Args**: `/absolute/path/to/jules-mcp/build/mcp-server/jules_mcp_server.js`
- **Env**: `JULES_API_KEY` = `<your-token>`
