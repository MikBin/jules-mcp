# Jules MCP Server (TypeScript)

A minimal MCP (Model Context Protocol) server that wraps the Google Jules API over stdio JSON-RPC.

## Overview

This server implements the MCP protocol for interacting with Google Jules, an AI-powered code assistant. It exposes tools for creating, monitoring, and managing Jules sessions through a JSON-RPC interface over stdin/stdout.

## Server Identity

- **Name:** `jules-mcp`
- **Version:** `1.0.0`
- **Protocol Version:** `2024-11-05`
- **Transport:** stdio JSON-RPC

## Usage

### Direct Execution

```bash
# Set required environment variable
export JULES_API_KEY="your-api-key"

# Build and run the server
npm run build
node build/mcp-server/jules_mcp_server.js
```

### With MCP Client

```bash
# Use the provided MCP client
npm run mcp-client -- \
  --command node build/mcp-server/jules_mcp_server.js \
  --tool jules_get_session \
  --arguments '{"session_id": "abc123"}'
```

### JSON-RPC Protocol

The server communicates via JSON-RPC 2.0 over stdin/stdout. Each request is a single JSON object per line.

#### Initialize

```json
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {"name": "jules-mcp", "version": "1.0.0"},
    "capabilities": {"tools": {}}
  }
}
```

#### List Tools

```json
{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
```

#### Call Tool

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "jules_get_session",
    "arguments": {"session_id": "abc123"}
  }
}
```

## Available Tools

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `jules_create_session` | Create a new Jules session | owner, repo, branch, prompt |
| `jules_get_session` | Fetch session metadata and status | session_id |
| `jules_list_sessions` | List all sessions | (none required) |
| `jules_delete_session` | Delete a session | session_id |
| `jules_send_message` | Send a message to Jules | session_id, message |
| `jules_approve_plan` | Approve a pending plan | session_id |
| `jules_list_activities` | List session activities | session_id |
| `jules_get_activity` | Get a single activity | session_id, activity_id |
| `jules_list_sources` | List connected repositories | (none required) |
| `jules_get_source` | Get source details | source_id |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JULES_API_KEY` | Yes | API key from jules.google.com/settings |
| `JULES_API_BASE` | No | Base URL for Jules API (default: https://jules.googleapis.com/v1alpha) |

## Dependencies

This server uses the MCP TypeScript SDK and Zod for schemas:

- `@modelcontextprotocol/sdk`
- `zod`

## Error Handling

Errors are returned as JSON-RPC error responses:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "HTTP 404 for https://jules.googleapis.com/v1alpha/sessions/invalid: Not found"
  }
}
```

## Integration

This MCP server is designed to work with the Jules Manager system:

1. **Local Agent** calls MCP tools to create and register jobs
2. **Background Monitor** polls Jules API independently
3. **Event Watcher** triggers the local agent when actionable events occur
4. **Event Handler** uses MCP tools to respond to events

See the main [README.md](../README.md) for full system documentation.
