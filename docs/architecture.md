# Jules Manager - Architectural Design (TypeScript)

## Overview

An MCP server implementation for orchestrating Google Jules as a remote coding agent from a local coding agent. The system handles the full lifecycle: task decomposition, API-based dispatch to Jules, asynchronous status monitoring, intervention handling, code review, and PR merging.

**Core Constraint:** The local agent must not waste context window tokens on active polling. A decoupled monitoring mechanism handles polling independently and only triggers the local agent when human-level input or a final review is required.

---

## 1. Architectural Workflow

### Step-by-Step Interaction Loop

```mermaid
sequenceDiagram
    participant User
    participant LocalAgent as Local Agent
    participant MCP as MCP Server
    participant Monitor as Background Monitor
    participant Watcher as Event Watcher
    participant Jules as Google Jules API
    participant Queue as Event Queue

    User->>LocalAgent: Submit task
    LocalAgent->>LocalAgent: Analyze and decompose task
    LocalAgent->>MCP: jules_create_job
    MCP->>Jules: POST /jobs
    Jules-->>MCP: job_id
    MCP-->>LocalAgent: job_id
    LocalAgent->>MCP: jules_register_job
    MCP->>Queue: Write to jobs.jsonl

    Note over Monitor: Runs independently
    Monitor->>Queue: Read jobs.jsonl
    Monitor->>Jules: GET /jobs/id - poll status
    Jules-->>Monitor: status + messages
    Monitor->>Monitor: Filter actionable events
    Monitor->>Queue: Write to events.jsonl

    Note over Watcher: Tails event queue
    Watcher->>Queue: Read events.jsonl
    Watcher->>LocalAgent: Trigger with JULES_EVENT

    alt Question Event
        LocalAgent->>MCP: jules_send_message
        MCP->>Jules: POST /jobs/id/messages
    else Completion Event
        LocalAgent->>MCP: jules_get_artifacts
        MCP->>Jules: GET /jobs/id/artifacts
        LocalAgent->>LocalAgent: Review code
        LocalAgent->>MCP: jules_merge_pr
        MCP->>Jules: POST /jobs/id/merge
    else Error Event
        LocalAgent->>MCP: jules_request_retry
        MCP->>Jules: POST /jobs/id/retry
    end
```

### Lifecycle Phases

| Phase | Description | Local Agent Action | Background Process |
|-------|-------------|------------|-------------------|
| 1. Intake | Receive user task | Analyze scope, success criteria | None |
| 2. Decomposition | Break into Jules-sized work | Create subtasks, define acceptance | None |
| 3. Dispatch | Create Jules jobs | Call MCP tools, register job IDs | None |
| 4. Monitoring | Track job progress | **Idle** | Poll Jules API, filter events |
| 5. Intervention | Handle questions/stuck | Respond via MCP, update prompts | Detect stuck states |
| 6. Review | Code review on completion | Fetch artifacts, run tests | None |
| 7. Merge | Merge PR after CI passes | Call merge API, cleanup | None |
| 8. Archive | Post-merge cleanup | Close job, update tracking | None |

---

## 2. MCP Server Strategy

### Custom MCP Server Specification

#### Server Identity
- **Name:** `jules-mcp`
- **Version:** `1.0.0`
- **Protocol Version:** `2024-11-05`
- **Transport:** stdio JSON-RPC

#### Tool Definitions

| Tool | Description | Parameters | Jules API Endpoint |
|------|-------------|------------|-------------------|
| `jules_create_job` | Create a new Jules job | repo, branch, prompt, constraints | POST /jobs |
| `jules_register_job` | Register job ID with monitor | job_id, jobs_path, metadata | Local file |
| `jules_get_job` | Fetch job metadata and status | job_id | GET /jobs/{id} |
| `jules_get_messages` | Fetch messages since cursor | job_id, cursor | GET /jobs/{id}/messages |
| `jules_send_message` | Send clarification to Jules | job_id, message | POST /jobs/{id}/messages |
| `jules_get_artifacts` | Get diff/patch/PR URL | job_id | GET /jobs/{id}/artifacts |
| `jules_request_retry` | Retry or re-run a job | job_id | POST /jobs/{id}:retry |
| `jules_merge_pr` | Merge PR after CI passes | job_id, payload | POST /jobs/{id}:merge |
| `jules_cancel_job` | Cancel a running job | job_id | POST /jobs/{id}:cancel |
| `jules_list_jobs` | List all jobs for a repo | repo, limit | GET /jobs |

#### Authentication
- Uses `JULES_API_TOKEN` environment variable
- Bearer token authentication in Authorization header
- Optional `JULES_API_BASE` for custom endpoints

---

## 3. Background Monitoring System

### Architecture

```mermaid
flowchart TB
    subgraph Background Process
        M[Monitor Script]
        S[State File]
        J[Jobs JSONL]
        E[Events JSONL]
    end

    subgraph Local Agent Context
        Z[Local Agent]
        H[Event Handler]
    end

    subgraph External
        API[Jules API]
    end

    J -->|Read job IDs| M
    M -->|Poll status| API
    API -->|Response| M
    M -->|Update| S
    M -->|Write actionable| E

    E -->|Tail| W[Event Watcher]
    W -->|JULES_EVENT env| H
    H -->|Invoke| Z
```

### Monitor Script Behavior

The monitor runs as an independent process with its own token budget:

1. **Read Jobs File:** Load active job IDs from `jobs.jsonl`
2. **Poll Jules API:** Query each job status at configured interval
3. **Track State:** Maintain cursor and last-known status per job
4. **Filter Events:** Only emit actionable events
5. **Write Events:** Append to `events.jsonl`

### Actionable Event Types

| Event Type | Trigger Condition | Data Included |
|------------|-------------------|---------------|
| `question` | Jules asks for clarification | job_id, message content |
| `completed` | Job status = COMPLETED | job_id, status payload |
| `error` | Job status = FAILED/ERROR | job_id, error details |
| `stuck` | No progress for N minutes | job_id, last_activity timestamp |

### Event Schema

```json
{
  "event": "question|completed|error|stuck",
  "job_id": "string",
  "observed_at": "ISO8601 timestamp",
  "status": "current job status",
  "message": "for question events - the question content",
  "payload": "full API response for context",
  "last_activity": "for stuck events - timestamp of last activity"
}
```

### Token Efficiency Mechanism

```mermaid
flowchart LR
    subgraph Traditional Polling - Wasteful
        A1[Local Agent] -->|Query| J1[Jules]
        J1 -->|In Progress| A1
        A1 -->|Query| J1
        J1 -->|In Progress| A1
        A1 -->|Query| J1
        J1 -->|Done| A1
    end

    subgraph Decoupled Monitoring - Efficient
        A2[Local Agent] -->|Register| M2[Monitor]
        M2 -->|Poll| J2[Jules]
        J2 -->|In Progress| M2
        M2 -->|Silent| M2
        M2 -->|Poll| J2
        J2 -->|Done| M2
        M2 -->|Trigger| A2
    end
```

**Key Insight:** The local agent only wakes when the monitor writes an actionable event. All intermediate polling happens outside the agent context.

---

## 4. Project Structure

```
jules-manager/
"o"?"? README.md                    # Quick start guide
"o"?"? config.json                  # Shared configuration
"o"?"? jobs.jsonl                   # Active jobs registry
"o"?"? events.jsonl                 # Actionable event queue
"o"?"? docs/
"'   """?"? architecture.md          # This document
"o"?"? mcp-server/
"'   "o"?"? jules_mcp_server.ts      # MCP server implementation
"'   """?"? README.md                # MCP server docs
"o"?"? src/
"'   "o"?"? mcp_client.ts            # CLI MCP client helper
"o"?"? scripts/
    "o"?"? jules_monitor.ts         # Background poller
    "o"?"? jules_event_watcher.ts   # Event queue watcher
    "o"?"? event_handler.ts         # Event handler
```

---

## 5. Configuration Schema

```json
{
  "jobs_path": "jules-manager/jobs.jsonl",
  "events_path": "jules-manager/events.jsonl",
  "monitor_state_path": "jules-manager/.monitor_state.json",
  "watcher_state_path": "jules-manager/.watcher_state.json",
  "monitor_poll_seconds": 45,
  "watcher_poll_seconds": 1,
  "stuck_minutes": 20,
  "api_base": "https://jules.googleapis.com/v1",
  "mcp_command": ["node", "jules-manager/build/mcp-server/jules_mcp_server.js"],
  "event_command": ["node", "jules-manager/scripts/event_handler.js"]
}
```

---

## 6. Implementation Artifacts

### 6.1 MCP Server (mcp-server/jules_mcp_server.ts)

A minimal stdio JSON-RPC server that:
- Implements MCP protocol handshake
- Exposes Jules API tools
- Handles authentication via environment
- Returns structured responses

### 6.2 Background Monitor (jules_monitor.ts)

A long-running Node.js script that:
- Loads configuration from config.json
- Reads active jobs from jobs.jsonl
- Polls Jules API at configured interval
- Maintains state in .monitor_state.json
- Writes actionable events to events.jsonl

### 6.3 Event Watcher (jules_event_watcher.ts)

A file-tailing script that:
- Monitors events.jsonl for new entries
- Invokes handler command with JULES_EVENT env var
- Tracks read offset in .watcher_state.json

### 6.4 Event Handler (event_handler.ts)

The event handler that:
- Reads JULES_EVENT from environment
- Routes to appropriate handler based on event type
- Invokes MCP tools for Jules interaction
- Returns control to the local agent main context

---

## 7. Usage Flow

### Starting the System

```bash
# Terminal 1: Build MCP server
npm run build

# Terminal 2: Start background monitor
node scripts/jules_monitor.js --config config.json

# Terminal 3: Start event watcher
node scripts/jules_event_watcher.js --command "node scripts/event_handler.js"
```

### Local Agent Workflow

```typescript
// In local agent context - creating a job
const result = await mcpCall("jules_create_job", {
  repo: "owner/repo",
  branch: "feature/new-auth",
  prompt: "Implement OAuth2 authentication"
});
const jobId = result.job_id;

// Register for monitoring
await mcpCall("jules_register_job", {
  job_id: jobId,
  jobs_path: "jules-manager/jobs.jsonl",
  metadata: { task: "OAuth2 implementation" }
});
```

---

## 8. Error Handling

| Scenario | Detection | Recovery |
|----------|------------|----------|
| API rate limit | HTTP 429 | Exponential backoff in monitor |
| Auth failure | HTTP 401 | Log error, emit error event |
| Network timeout | Request timeout | Retry with backoff, emit error after N retries |
| Invalid job ID | HTTP 404 | Remove from jobs file, emit error |
| Stuck detection | No status change for N min | Emit stuck event for intervention |

---

## 9. Security Considerations

- **API Token:** Stored in environment, never in files
- **Job Files:** Contain only job IDs and metadata, no secrets
- **Event Files:** Contain only status data, no sensitive info
- **MCP Transport:** stdio only, no network exposure

---

## 10. Future Enhancements

1. **Webhook Support:** If Jules adds webhooks, replace polling with push
2. **Multi-repo Support:** Aggregate jobs across repositories
3. **Priority Queue:** Allow job prioritization in monitor
4. **Metrics Dashboard:** Expose Prometheus metrics for monitoring
5. **Distributed Mode:** Support multiple monitor instances with coordination
