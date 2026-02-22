import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "url";

const SERVER_NAME = "jules-mcp";
const SERVER_VERSION = "2.0.0";

export const DEFAULT_API_BASE = "https://jules.googleapis.com/v1alpha";
export const API_BASE = process.env.JULES_API_BASE ?? DEFAULT_API_BASE;
export const API_KEY = process.env.JULES_API_KEY;

type JsonRecord = Record<string, unknown>;
type StructuredContent = Record<string, unknown> | undefined;
type ToolResponse = {
  content: { type: "text"; text: string }[];
  structuredContent?: StructuredContent;
};

export function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (API_KEY) {
    headers["x-goog-api-key"] = API_KEY;
  }
  return headers;
}

export async function requestJson(
  url: string,
  options: RequestInit = {}
): Promise<unknown> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${detail}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function urlJoin(path: string): string {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return `${API_BASE.replace(/\/$/, "")}/${normalized}`;
}

// --- API helpers ---

export async function createSession(payload: JsonRecord): Promise<unknown> {
  return requestJson(urlJoin("sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getSession(sessionId: string): Promise<unknown> {
  return requestJson(urlJoin(`sessions/${sessionId}`));
}

export async function listSessions(
  pageSize?: number,
  pageToken?: string
): Promise<unknown> {
  const params = new URLSearchParams();
  if (pageSize !== undefined) params.set("pageSize", String(pageSize));
  if (pageToken) params.set("pageToken", pageToken);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(urlJoin(`sessions${query}`));
}

export async function deleteSession(sessionId: string): Promise<unknown> {
  return requestJson(urlJoin(`sessions/${sessionId}`), { method: "DELETE" });
}

export async function sendMessage(
  sessionId: string,
  prompt: string
): Promise<unknown> {
  return requestJson(urlJoin(`sessions/${sessionId}:sendMessage`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

export async function approvePlan(sessionId: string): Promise<unknown> {
  return requestJson(urlJoin(`sessions/${sessionId}:approvePlan`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function listActivities(
  sessionId: string,
  pageSize?: number,
  pageToken?: string
): Promise<unknown> {
  const params = new URLSearchParams();
  if (pageSize !== undefined) params.set("pageSize", String(pageSize));
  if (pageToken) params.set("pageToken", pageToken);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(urlJoin(`sessions/${sessionId}/activities${query}`));
}

export async function getActivity(
  sessionId: string,
  activityId: string
): Promise<unknown> {
  return requestJson(
    urlJoin(`sessions/${sessionId}/activities/${activityId}`)
  );
}

export async function listSources(
  pageSize?: number,
  pageToken?: string
): Promise<unknown> {
  const params = new URLSearchParams();
  if (pageSize !== undefined) params.set("pageSize", String(pageSize));
  if (pageToken) params.set("pageToken", pageToken);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson(urlJoin(`sources${query}`));
}

export async function getSource(sourceId: string): Promise<unknown> {
  return requestJson(urlJoin(`sources/${sourceId}`));
}

// --- Response helpers ---

function toStructuredContent(payload: unknown): StructuredContent {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as StructuredContent;
  }
  return undefined;
}

function buildToolResponse(payload: unknown): ToolResponse {
  const contentItem = {
    type: "text" as const,
    text: JSON.stringify(payload, null, 2),
  };
  return {
    content: [contentItem],
    structuredContent: toStructuredContent(payload),
  };
}

// --- MCP Server ---

export const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

server.registerTool(
  "jules_create_session",
  {
    title: "Create a new Jules session",
    description:
      "Create a new Jules coding session for a GitHub repository",
    inputSchema: {
      owner: z.string().describe("GitHub repository owner"),
      repo: z.string().describe("GitHub repository name"),
      branch: z.string().describe("Starting branch name"),
      prompt: z.string().describe("Task description for Jules"),
      title: z.string().optional().describe("Optional session title"),
      requirePlanApproval: z
        .boolean()
        .optional()
        .describe("Whether to require plan approval before execution"),
      automationMode: z
        .string()
        .optional()
        .describe('Automation mode, e.g. "AUTO_CREATE_PR"'),
    },
  },
  async ({ owner, repo, branch, prompt, title, requirePlanApproval, automationMode }) => {
    const body: JsonRecord = {
      prompt,
      sourceContext: {
        source: `sources/github/${owner}/${repo}`,
        githubRepoContext: { startingBranch: branch },
      },
    };
    if (title !== undefined) body.title = title;
    if (requirePlanApproval !== undefined)
      body.requirePlanApproval = requirePlanApproval;
    if (automationMode !== undefined) body.automationMode = automationMode;
    const payload = await createSession(body);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_get_session",
  {
    title: "Get session details",
    description: "Fetch session metadata, state, and outputs",
    inputSchema: {
      session_id: z.string().describe("The Jules session ID"),
    },
  },
  async ({ session_id }) => {
    const payload = await getSession(session_id);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_list_sessions",
  {
    title: "List sessions",
    description: "List Jules sessions",
    inputSchema: {
      pageSize: z.number().optional().describe("Maximum number of sessions to return"),
      pageToken: z.string().optional().describe("Page token for pagination"),
    },
  },
  async ({ pageSize, pageToken }) => {
    const payload = await listSessions(pageSize, pageToken);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_delete_session",
  {
    title: "Delete a session",
    description: "Delete a Jules session",
    inputSchema: {
      session_id: z.string().describe("The Jules session ID"),
    },
  },
  async ({ session_id }) => {
    const payload = await deleteSession(session_id);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_send_message",
  {
    title: "Send message to session",
    description: "Send a clarification or instruction to a Jules session",
    inputSchema: {
      session_id: z.string().describe("The Jules session ID"),
      message: z.string().describe("Message text to send"),
    },
  },
  async ({ session_id, message }) => {
    const payload = await sendMessage(session_id, message);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_approve_plan",
  {
    title: "Approve session plan",
    description: "Approve the plan for a session awaiting plan approval",
    inputSchema: {
      session_id: z.string().describe("The Jules session ID"),
    },
  },
  async ({ session_id }) => {
    const payload = await approvePlan(session_id);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_list_activities",
  {
    title: "List session activities",
    description: "List activities for a Jules session",
    inputSchema: {
      session_id: z.string().describe("The Jules session ID"),
      pageSize: z.number().optional().describe("Maximum number of activities to return"),
      pageToken: z.string().optional().describe("Page token for pagination"),
    },
  },
  async ({ session_id, pageSize, pageToken }) => {
    const payload = await listActivities(session_id, pageSize, pageToken);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_get_activity",
  {
    title: "Get a single activity",
    description: "Get a single activity by ID for a Jules session",
    inputSchema: {
      session_id: z.string().describe("The Jules session ID"),
      activity_id: z.string().describe("The activity ID"),
    },
  },
  async ({ session_id, activity_id }) => {
    const payload = await getActivity(session_id, activity_id);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_list_sources",
  {
    title: "List sources",
    description: "List available sources (GitHub repositories)",
    inputSchema: {
      pageSize: z.number().optional().describe("Maximum number of sources to return"),
      pageToken: z.string().optional().describe("Page token for pagination"),
    },
  },
  async ({ pageSize, pageToken }) => {
    const payload = await listSources(pageSize, pageToken);
    return buildToolResponse(payload);
  }
);

server.registerTool(
  "jules_get_source",
  {
    title: "Get source details",
    description: "Get details for a specific source",
    inputSchema: {
      source_id: z.string().describe("The source ID"),
    },
  },
  async ({ source_id }) => {
    const payload = await getSource(source_id);
    return buildToolResponse(payload);
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} MCP server running on stdio`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Fatal error in MCP server:", error);
    process.exit(1);
  });
}
