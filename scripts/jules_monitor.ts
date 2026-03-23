import { promises as fs } from "fs";
import { execFile } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";

const DEFAULT_POLL_SECONDS = 45;
const DEFAULT_STUCK_MINUTES = 20;
const DEFAULT_STATE_PATH = ".monitor_state.json";
const DEFAULT_CONFIG_PATH = process.env.JULES_CONFIG ?? "jules-manager/config.json";

const MCP_TOOL_CHECK_JULES = "jules_check_jules";
const CHECK_CODE_TO_EVENT: Record<string, "question" | "completed" | "error" | null> = {
  Q: "question",
  C: "completed",
  F: "error",
  N: null,
};

type JsonRecord = Record<string, unknown>;
type MCPCommand = string[];

type CheckCode = "Q" | "C" | "F" | "N";

type CheckResult = {
  code: CheckCode;
  state: string;
  sessionId?: string;
};

type JobState = {
  session_id?: string;
  last_status?: string;
  last_activity?: string;
};

function utcNow(): string {
  return new Date().toISOString();
}

export async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function loadConfig(path: string): Promise<JsonRecord> {
  return loadJson<JsonRecord>(path, {});
}

async function saveJson(path: string, payload: unknown): Promise<void> {
  await fs.mkdir(dirname(path) || ".", { recursive: true });
  await fs.writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}

async function appendJsonl(path: string, payload: JsonRecord): Promise<void> {
  await fs.mkdir(dirname(path) || ".", { recursive: true });
  await fs.appendFile(path, `${JSON.stringify(payload)}\n`, "utf8");
}

async function loadJobs(path: string): Promise<JsonRecord[]> {
  try {
    const content = await fs.readFile(path, "utf8");
    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("[")) {
      const jobs = JSON.parse(trimmed) as JsonRecord[];
      return jobs.map((entry) =>
        typeof entry === "string" ? { session_id: entry } : entry
      );
    }
    return trimmed
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as JsonRecord)
      .map((entry) => (typeof entry === "string" ? { session_id: entry } : entry));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function buildHeaders(apiKey?: string | null): HeadersInit {
  const headers: HeadersInit = { Accept: "application/json" };
  if (apiKey) {
    (headers as Record<string, string>)["x-goog-api-key"] = apiKey;
  }
  return headers;
}

export function sessionStatusUrl(apiBase: string, sessionId: string): string {
  return `${apiBase.replace(/\/$/, "")}/sessions/${sessionId}`;
}

export function sessionActivitiesUrl(
  apiBase: string,
  sessionId: string,
  pageToken?: string
): string {
  const base = `${apiBase.replace(/\/$/, "")}/sessions/${sessionId}/activities`;
  if (!pageToken) {
    return base;
  }
  return `${base}?pageToken=${encodeURIComponent(pageToken)}`;
}

export function isQuestionActivity(activity: JsonRecord): boolean {
  const agentMessaged = activity.agentMessaged as JsonRecord | undefined;
  if (!agentMessaged) {
    return false;
  }
  const text = String(
    (agentMessaged as JsonRecord).agentMessage ?? ""
  ).toLowerCase();
  return text.includes("?");
}

export function findActionableActivity(activities: JsonRecord[]): JsonRecord | undefined {
  return activities.find(isQuestionActivity);
}

function parseMcpCommand(configValue: unknown): MCPCommand {
  if (Array.isArray(configValue)) {
    return configValue.map(String).filter(Boolean);
  }
  if (typeof configValue === "string" && configValue.trim()) {
    return [configValue.trim()];
  }
  return [];
}

function getJobKey(job: JsonRecord): string {
  if (typeof job.session_id === "string" && job.session_id.trim()) {
    return `session:${job.session_id.trim()}`;
  }
  const owner = typeof job.owner === "string" ? job.owner.trim() : "";
  const repo = typeof job.repo === "string" ? job.repo.trim() : "";
  const branch = typeof job.branch === "string" ? job.branch.trim() : "";
  if (owner && repo) {
    return `project:${owner}/${repo}#${branch || "*"}`;
  }
  return `invalid:${JSON.stringify(job)}`;
}

function getCheckArguments(job: JsonRecord): JsonRecord {
  const sessionId = typeof job.session_id === "string" ? job.session_id.trim() : "";
  if (sessionId) {
    return { session_id: sessionId };
  }

  const owner = typeof job.owner === "string" ? job.owner.trim() : "";
  const repo = typeof job.repo === "string" ? job.repo.trim() : "";
  const branch = typeof job.branch === "string" ? job.branch.trim() : "";
  if (!owner || !repo) {
    throw new Error(
      "Each job must include either session_id or owner+repo (optional branch)."
    );
  }

  if (branch) {
    return { owner, repo, branch };
  }
  return { owner, repo };
}

async function runMcp(
  command: MCPCommand,
  tool: string,
  arguments_: JsonRecord
): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: "2.0",
      id: "jules-monitor",
      method: "tools/call",
      params: { name: tool, arguments: arguments_ },
    };

    const child = execFile(
      command[0],
      command.slice(1),
      {
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        const lines = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        for (const line of lines) {
          try {
            const response = JSON.parse(line) as JsonRecord;
            if (response.id === "jules-monitor") {
              resolve((response.result as JsonRecord) ?? {});
              return;
            }
          } catch {
            continue;
          }
        }
        resolve({});
      }
    );

    child.stdin?.write(JSON.stringify(request));
    child.stdin?.write("\n");
    child.stdin?.end();
  });
}

function parseCheckResult(result: JsonRecord): CheckResult {
  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? (result.structuredContent as JsonRecord)
      : undefined;
  const structuredCode =
    typeof structured?.c === "string" ? structured.c.toUpperCase() : "";
  const content = Array.isArray(result.content)
    ? (result.content as JsonRecord[])
    : [];
  const contentCodeRaw =
    content.length > 0 && typeof content[0].text === "string"
      ? content[0].text.trim().toUpperCase()
      : "";
  const parsedCode = (structuredCode || contentCodeRaw || "N").slice(0, 1);
  const code: CheckCode =
    parsedCode === "Q" || parsedCode === "C" || parsedCode === "F"
      ? parsedCode
      : "N";

  return {
    code,
    state: typeof structured?.st === "string" ? structured.st : "UNKNOWN",
    sessionId:
      typeof structured?.s === "string" && structured.s.trim()
        ? structured.s.trim()
        : undefined,
  };
}

export function shouldEmitStuck(
  lastActivity: string | undefined,
  thresholdMinutes: number
): boolean {
  if (!lastActivity) {
    return false;
  }
  const last = Date.parse(lastActivity);
  if (Number.isNaN(last)) {
    return false;
  }
  const delta = Date.now() - last;
  return delta >= thresholdMinutes * 60 * 1000;
}

export async function monitorOnce(
  jobs: JsonRecord[],
  state: Record<string, JobState>,
  mcpCommand: MCPCommand,
  eventsPath: string,
  stuckMinutes: number
): Promise<void> {
  for (const job of jobs) {
    const jobKey = getJobKey(job);
    const jobState = (state[jobKey] ??= {});

    let checkArgs: JsonRecord;
    try {
      checkArgs = getCheckArguments(job);
    } catch (error) {
      await appendJsonl(eventsPath, {
        event: "error",
        session_id: jobState.session_id ?? null,
        observed_at: utcNow(),
        message: (error as Error).message,
      });
      continue;
    }

    let checkResult: CheckResult;
    try {
      const rawResult = await runMcp(mcpCommand, MCP_TOOL_CHECK_JULES, checkArgs);
      checkResult = parseCheckResult(rawResult);
    } catch (error) {
      await appendJsonl(eventsPath, {
        event: "error",
        session_id: jobState.session_id ?? null,
        observed_at: utcNow(),
        message: `jules_check_jules failed: ${(error as Error).message}`,
      });
      continue;
    }

    const previousCode = jobState.last_status;
    const statusChanged = checkResult.code !== previousCode;
    if (checkResult.sessionId) {
      jobState.session_id = checkResult.sessionId;
    }

    if (statusChanged) {
      jobState.last_status = checkResult.code;
      jobState.last_activity = utcNow();
    }

    const eventType = CHECK_CODE_TO_EVENT[checkResult.code];
    if (eventType && statusChanged) {
      await appendJsonl(eventsPath, {
        event: eventType,
        session_id: checkResult.sessionId ?? jobState.session_id ?? null,
        state: checkResult.state,
        check_code: checkResult.code,
        observed_at: utcNow(),
      });
      continue;
    }

    if (shouldEmitStuck(jobState.last_activity, stuckMinutes)) {
      await appendJsonl(eventsPath, {
        event: "stuck",
        session_id: checkResult.sessionId ?? jobState.session_id ?? null,
        observed_at: utcNow(),
        last_activity: jobState.last_activity ?? null,
      });
      jobState.last_activity = utcNow();
    }
  }
}

function parseArgs(argv: string[]): {
  jobs?: string;
  events?: string;
  state?: string;
  poll?: number;
  stuckMinutes?: number;
  apiBase?: string;
  config?: string;
} {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) {
      continue;
    }
    const key = entry.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
    } else {
      args[key] = value;
      index += 1;
    }
  }

  return {
    jobs: args.jobs,
    events: args.events,
    state: args.state,
    poll: args.poll ? Number(args.poll) : undefined,
    stuckMinutes: args["stuck-minutes"]
      ? Number(args["stuck-minutes"])
      : undefined,
    apiBase: args["api-base"],
    config: args.config,
  };
}

async function sleep(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.config ?? DEFAULT_CONFIG_PATH);

  const jobsPath = args.jobs ?? (config.jobs_path as string | undefined);
  const eventsPath = args.events ?? (config.events_path as string | undefined);
  const statePath =
    args.state ?? (config.monitor_state_path as string | undefined) ?? DEFAULT_STATE_PATH;
  const pollSeconds =
    args.poll ??
    (config.monitor_poll_seconds as number | undefined) ??
    DEFAULT_POLL_SECONDS;
  const mcpCommand = parseMcpCommand(config.mcp_command);
  const stuckMinutes =
    args.stuckMinutes ??
    (config.stuck_minutes as number | undefined) ??
    DEFAULT_STUCK_MINUTES;

  if (!jobsPath || !eventsPath) {
    console.error("Error: jobs_path and events_path must be provided");
    return 1;
  }

  if (mcpCommand.length === 0) {
    console.error("Error: mcp_command must be configured for monitor polling");
    return 1;
  }

  const stateRaw = await loadJson<Record<string, JobState>>(statePath, {});
  const state: Record<string, JobState> = { ...stateRaw };

  console.error(`Jules Monitor started - polling every ${pollSeconds}s`);
  console.error(`Jobs: ${jobsPath}`);
  console.error(`Events: ${eventsPath}`);

  while (true) {
    try {
      const jobs = await loadJobs(jobsPath);
      if (jobs.length > 0) {
        await monitorOnce(jobs, state, mcpCommand, eventsPath, stuckMinutes);
      }
    } catch (error) {
      await appendJsonl(eventsPath, {
        event: "error",
        session_id: null,
        observed_at: utcNow(),
        message: `Monitor error: ${(error as Error).message}`,
      });
    }

    await saveJson(statePath, state);
    await sleep(pollSeconds);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Fatal error in monitor:", error);
    process.exit(1);
  });
}
