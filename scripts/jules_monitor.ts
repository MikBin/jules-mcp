import { promises as fs } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

const DEFAULT_API_BASE = "https://jules.googleapis.com/v1alpha";
const DEFAULT_POLL_SECONDS = 45;
const DEFAULT_STUCK_MINUTES = 20;
const DEFAULT_STATE_PATH = ".monitor_state.json";
const DEFAULT_CONFIG_PATH = process.env.JULES_CONFIG ?? "jules-manager/config.json";

const ACTIONABLE_STATUSES = new Set(["COMPLETED", "FAILED"]);

type JsonRecord = Record<string, unknown>;

type JobState = {
  cursor?: string;
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

async function fetchJson(url: string, apiKey?: string | null): Promise<JsonRecord> {
  const response = await fetch(url, { headers: buildHeaders(apiKey) });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`HTTP ${response.status} for ${url}: ${detail}`);
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as JsonRecord) : {};
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
  apiBase: string,
  apiKey: string | undefined,
  eventsPath: string,
  stuckMinutes: number
): Promise<void> {
  for (const job of jobs) {
    const sessionId = String(job.session_id ?? "");
    if (!sessionId) {
      continue;
    }

    const jobState = (state[sessionId] ??= {});

    let statusPayload: JsonRecord;
    try {
      statusPayload = await fetchJson(sessionStatusUrl(apiBase, sessionId), apiKey);
    } catch (error) {
      await appendJsonl(eventsPath, {
        event: "error",
        session_id: sessionId,
        observed_at: utcNow(),
        message: (error as Error).message,
      });
      continue;
    }

    const sessionState = statusPayload.state ? String(statusPayload.state) : undefined;
    if (sessionState && sessionState !== jobState.last_status) {
      jobState.last_status = sessionState;
      jobState.last_activity = utcNow();
    }

    if (sessionState && ACTIONABLE_STATUSES.has(sessionState)) {
      await appendJsonl(eventsPath, {
        event: sessionState === "COMPLETED" ? "completed" : "error",
        session_id: sessionId,
        state: sessionState,
        observed_at: utcNow(),
        payload: statusPayload,
      });
      continue;
    }

    if (sessionState === "AWAITING_USER_FEEDBACK") {
      await appendJsonl(eventsPath, {
        event: "question",
        session_id: sessionId,
        state: sessionState,
        observed_at: utcNow(),
        payload: statusPayload,
      });
      jobState.last_activity = utcNow();
      continue;
    }

    let activitiesPayload: JsonRecord = {};
    try {
      activitiesPayload = await fetchJson(
        sessionActivitiesUrl(apiBase, sessionId, jobState.cursor),
        apiKey
      );
    } catch (error) {
      activitiesPayload = {};
    }

    const nextPageToken = activitiesPayload.nextPageToken
      ? String(activitiesPayload.nextPageToken)
      : undefined;
    const activities = Array.isArray(activitiesPayload.activities)
      ? (activitiesPayload.activities as JsonRecord[])
      : [];
    const actionableActivity = findActionableActivity(activities);

    if (nextPageToken) {
      jobState.cursor = nextPageToken;
    }

    if (actionableActivity) {
      await appendJsonl(eventsPath, {
        event: "question",
        session_id: sessionId,
        observed_at: utcNow(),
        activity: actionableActivity,
      });
      jobState.last_activity = utcNow();
      continue;
    }

    if (shouldEmitStuck(jobState.last_activity, stuckMinutes)) {
      await appendJsonl(eventsPath, {
        event: "stuck",
        session_id: sessionId,
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
  const apiKey = process.env.JULES_API_KEY;
  const config = await loadConfig(args.config ?? DEFAULT_CONFIG_PATH);

  const jobsPath = args.jobs ?? (config.jobs_path as string | undefined);
  const eventsPath = args.events ?? (config.events_path as string | undefined);
  const statePath =
    args.state ?? (config.monitor_state_path as string | undefined) ?? DEFAULT_STATE_PATH;
  const pollSeconds =
    args.poll ??
    (config.monitor_poll_seconds as number | undefined) ??
    DEFAULT_POLL_SECONDS;
  const apiBase =
    args.apiBase ??
    (config.api_base as string | undefined) ??
    DEFAULT_API_BASE;
  const stuckMinutes =
    args.stuckMinutes ??
    (config.stuck_minutes as number | undefined) ??
    DEFAULT_STUCK_MINUTES;

  if (!jobsPath || !eventsPath) {
    console.error("Error: jobs_path and events_path must be provided");
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
        await monitorOnce(jobs, state, apiBase, apiKey, eventsPath, stuckMinutes);
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
