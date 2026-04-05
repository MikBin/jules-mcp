# Jules Manager MCP Server Installation

This guide provides the necessary information for AI agents (like Amp, Cline, Windsurf, or Antigravity) to install and configure the **Jules Manager MCP Server**.

## Metadata
- **Name:** jules-mcp
- **Version:** 1.0.0
- **Language:** TypeScript/Node.js
- **Capabilities:** Coding Agent Orchestration, Session Management, Activity Listing, PR Extraction.

## Prerequisites
- Node.js 20 or higher.
- A valid **Google Jules API Key**.

## Installation Steps

### 1. Global Installation (via npx)
The easiest way to run the server without cloning the repository is using `npx`:
```bash
npx -y jules-mcp-ts
```

### 2. Manual Installation (from source)
If you have cloned the repository locally:
```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## Configuration

### Environment Variables
The server requires the following environment variable for authentication:

| Variable | Description |
| --- | --- |
| `JULES_API_KEY` | Your Google Jules API key. |

Optional variables:
| Variable | Description | Default |
| --- | --- | --- |
| `JULES_API_BASE` | Base URL for the Jules API. | `https://jules.googleapis.com/v1alpha` |

### Amp (VS Code Extension)

Add to your VS Code `settings.json` under `amp.mcpServers`:

```json
{
  "amp.mcpServers": {
    "jules-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/jules-mcp/build/mcp-server/jules_mcp_server.js"],
      "env": {
        "JULES_API_KEY": "<YOUR_JULES_API_KEY>"
      }
    }
  }
}
```

Or via npx (no local clone needed):

```json
{
  "amp.mcpServers": {
    "jules-mcp": {
      "command": "npx",
      "args": ["-y", "jules-mcp-ts"],
      "env": {
        "JULES_API_KEY": "<YOUR_JULES_API_KEY>"
      }
    }
  }
}
```

### Cline / Windsurf / Antigravity (mcp_config.json)

```json
{
  "mcpServers": {
    "jules-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/jules-mcp/build/mcp-server/jules_mcp_server.js"],
      "env": {
        "JULES_API_KEY": "<YOUR_JULES_API_KEY>"
      }
    }
  }
}
```

## Available Tools
- `jules_create_session`: Initialize a new coding task. **Important:** Always use the repository's default branch (`main` or `master`) as the starting branch. Jules automatically creates its own feature branch for each session.
- `jules_get_session`: Retrieve state and metadata for a session.
- `jules_check_jules`: Minimal polling status check returning only `Q`, `C`, `F`, or `N`.
- `jules_list_sessions`: List active and past sessions.
- `jules_delete_session`: Delete a Jules session.
- `jules_send_message`: Provide additional instructions to Jules.
- `jules_approve_plan`: Approve a proposed coding plan.
- `jules_list_activities`: View the detailed log of Jules' actions.
- `jules_get_activity`: Get a single activity by ID for a session.
- `jules_list_sources`: List available sources (GitHub repositories).
- `jules_get_source`: Get details for a specific source.
- `jules_extract_pr_from_session`: Get PR details from a finished session.
- `jules_monitor_session`: Poll a session until it completes or fails, with progress notifications.
- `jules_wait`: Pause execution for a given number of seconds (max 600) to conserve tokens between polling calls.
