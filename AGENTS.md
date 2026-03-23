# Jules MCP Orchestrator Mode

This document describes how to use the jules-mcp server in orchestrator mode where a local agent coordinates work with Jules as a remote coding assistant.

## Overview

Jules is an advanced developer agent. Simply specify the task clearly and concisely - no need to provide code snippets or implementation details. Jules will analyze the codebase, plan the work, and execute it independently.

## Orchestrator Workflow

When the local agent needs to delegate work to Jules, follow this sequential workflow:

### 1. Pull Latest Changes

Before creating any new Jules session, always pull the latest changes from the remote to ensure Jules works with up-to-date code:

```
git pull origin <branch>
```

### 2. Create Jules Session

Create a new Jules session for the task. Jules is autonomous - describe what needs to be done:

**Required parameters:**
- `owner`: GitHub repository owner (e.g., "MikBin")
- `repo`: Repository name (e.g., "jules-mcp")
- `branch`: Starting branch (e.g., "main")
- `prompt`: Clear task description

**Optional parameters:**
- `title`: Session title for identification
- `requirePlanApproval`: Set to `true` if you want to review before execution
- `automationMode`: Set to `"AUTO_CREATE_PR"` for automatic PR creation on completion

### 3. Monitor Session

Wait for the session to complete. Check session status periodically using the sleep MCP server to conserve tokens:
- Use `sleep_mcp` to wait configurable seconds between status checks (recommended: 120 seconds)
- For periodic polling, use `jules_check_jules` only (compact `Q/C/F/N` response)
- If state is `AWAITING_PLAN_APPROVAL`, approve the plan
- If state is `AWAITING_USER_FEEDBACK`, respond using `jules_send_message` to provide clarification or additional instructions
- If state is `IN_PROGRESS`, continue monitoring (sleep then check again)
- If state is `COMPLETED` or `FAILED`, proceed to next step

Hard rule: do not use `jules_get_session` for periodic polling. Use it only after an actionable signal (`Q`, `C`, or `F`) when detailed metadata is actually needed.

**Note:** The sleep MCP server (`csBeyp0mcp0sleep` / `github.com/Garoth/sleep-mcp`) helps save context window tokens by avoiding active polling. Configure the wait interval based on expected task duration.

**Clarification Handling:** The local orchestrator should be ready to clarify anything Jules requests when stuck. Use `jules_send_message` to provide answers, context, or guidance as needed.

### 4. Extract PR Information

When session completes, extract the PR information from the session outputs to get the PR URL and details.

### 5. Merge PR

Merge the created PR using the GitHub MCP server:
- Use `merge_pull_request` tool
- Specify `merge_method` (squash recommended)
- Include a descriptive commit message

### 6. Delete Branch

Delete the merged branch to keep the repository clean:
- Use `delete_branch` tool from GitHub MCP

### 7. Pull Changes Locally

Pull the merged changes to keep your local repository in sync:
```
git pull origin <branch>
```

## Sequential Processing

**Important:** Sessions must be processed sequentially. Do not create a new Jules session while another is still active. Always complete the full workflow (create → monitor → approve if needed → extract PR → merge → delete branch → pull) before starting the next session.

## Error Handling

- If session fails, review the error details and create a new session with corrected instructions if needed
- If PR merge fails, investigate the conflict and resolve before retrying
- Always clean up branches even on failure to avoid orphan branches

---

## Appendix: Jules MCP Server API Reference

### Session Management

| Tool | Description |
|------|-------------|
| `jules_create_session` | Create a new Jules coding session for a GitHub repository |
| `jules_get_session` | Fetch session metadata, state, and outputs |
| `jules_check_jules` | Minimal polling check returning `Q`, `C`, `F`, or `N` |
| `jules_list_sessions` | List all Jules sessions |
| `jules_delete_session` | Delete a Jules session |
| `jules_approve_plan` | Approve the plan for a session awaiting approval |
| `jules_send_message` | Send a clarification or instruction to a session |

### Monitoring & Activity

| Tool | Description |
|------|-------------|
| `jules_list_activities` | List activities for a Jules session |
| `jules_get_activity` | Get a single activity by ID |
| `jules_monitor_session` | Poll a session until completion with progress notifications |

### Sources

| Tool | Description |
|------|-------------|
| `jules_list_sources` | List available GitHub repositories |
| `jules_get_source` | Get details for a specific source |

### Pull Requests

| Tool | Description |
|------|-------------|
| `jules_extract_pr_from_session` | Extract PR information from completed session outputs |

### Tool Parameters

#### jules_create_session
- `owner` (string, required): GitHub repository owner
- `repo` (string, required): GitHub repository name
- `branch` (string, required): Starting branch name
- `prompt` (string, required): Task description for Jules
- `title` (string, optional): Session title
- `requirePlanApproval` (boolean, optional): Require plan approval before execution
- `automationMode` (string, optional): Set to `"AUTO_CREATE_PR"` for automatic PR creation

#### jules_get_session
- `session_id` (string, required): The Jules session ID

#### jules_check_jules
- `session_id` (string, optional): Check a specific session directly
- `owner` (string, optional): Repository owner (required if `session_id` is omitted)
- `repo` (string, optional): Repository name (required if `session_id` is omitted)
- `branch` (string, optional): Optional branch filter for project-based polling

#### jules_approve_plan
- `session_id` (string, required): The Jules session ID

#### jules_send_message
- `session_id` (string, required): The Jules session ID
- `message` (string, required): Message text to send

#### jules_monitor_session
- `session_id` (string, required): The Jules session ID to monitor
- `poll_interval_seconds` (number, optional): Polling interval in seconds (default: 60, max: 300)

#### jules_extract_pr_from_session
- `session_id` (string, required): The completed Jules session ID

#### jules_delete_session
- `session_id` (string, required): The Jules session ID

### Session States

| State | Description |
|-------|-------------|
| `IN_PROGRESS` | Session is actively working |
| `AWAITING_PLAN_APPROVAL` | Plan ready for review and approval |
| `AWAITING_USER_FEEDBACK` | Session needs input or clarification |
| `COMPLETED` | Session finished successfully (check outputs for PR) |
| `FAILED` | Session encountered an error |

### Session Outputs

When a session completes successfully with `automationMode: "AUTO_CREATE_PR"`, the session outputs contain:
- `changeSet.gitPatch`: The diff/patch of changes made
- `changeSet.suggestedCommitMessage`: Suggested commit message
- `pullRequest.url`: The created PR URL
- `pullRequest.title`: PR title
- `pullRequest.description`: PR description
- `pullRequest.baseRef`: Target branch
- `pullRequest.headRef`: Feature branch created
