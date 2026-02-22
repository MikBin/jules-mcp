import { spawn } from "child_process";
import { promises as fs } from "fs";
import { dirname } from "path";

const DEFAULT_CONFIG_PATH = process.env.JULES_CONFIG ?? "jules-manager/config.json";
const DEFAULT_STATE_PATH = ".watcher_state.json";
const DEFAULT_POLL_SECONDS = 1;

type JsonRecord = Record<string, unknown>;

type WatcherState = {
  offset: number;
};

function parseArgs(argv: string[]): {
  events?: string;
  command?: string;
  poll?: number;
  state?: string;
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
    events: args.events,
    command: args.command,
    poll: args.poll ? Number(args.poll) : undefined,
    state: args.state,
    config: args.config,
  };
}

async function loadState(path: string): Promise<WatcherState> {
  try {
    const content = await fs.readFile(path, "utf8");
    return JSON.parse(content) as WatcherState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { offset: 0 };
    }
    throw error;
  }
}

async function loadConfig(path: string): Promise<JsonRecord> {
  try {
    const content = await fs.readFile(path, "utf8");
    return JSON.parse(content) as JsonRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function saveState(path: string, state: WatcherState): Promise<void> {
  await fs.mkdir(dirname(path) || ".", { recursive: true });
  await fs.writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

function runCommand(command: string, event: JsonRecord): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: "inherit",
      env: {
        ...process.env,
        JULES_EVENT: JSON.stringify(event),
      },
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function watch(
  eventsPath: string,
  command: string,
  pollSeconds: number,
  statePath: string
): Promise<void> {
  let state = await loadState(statePath);
  console.error("Event Watcher started");
  console.error(`Events: ${eventsPath}`);
  console.error(`Handler: ${command}`);

  while (true) {
    try {
      const stat = await fs.stat(eventsPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      });

      if (!stat) {
        await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
        continue;
      }

      if (stat.size < state.offset) {
        state = { offset: 0 };
      }

      if (stat.size === state.offset) {
        await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
        await saveState(statePath, state);
        continue;
      }

      const handle = await fs.open(eventsPath, "r");
      try {
        const remaining = Math.max(stat.size - state.offset, 0);
        if (remaining === 0) {
          state = { offset: stat.size };
          continue;
        }
        const buffer = Buffer.alloc(remaining);
        await handle.read(buffer, 0, buffer.length, state.offset);
        const chunk = buffer.toString("utf8");
        const lines = chunk.split(/\r?\n/).filter((line) => line.trim());
        for (const line of lines) {
          let event: JsonRecord | null = null;
          try {
            event = JSON.parse(line) as JsonRecord;
          } catch (error) {
            event = null;
          }
          if (!event) {
            continue;
          }
          const eventType = event.event ?? "unknown";
          const jobId = event.job_id ?? "unknown";
          console.error(`Processing ${eventType} event for job ${jobId}`);
          const exitCode = await runCommand(command, event);
          if (exitCode !== 0) {
            console.error(`Handler returned exit code ${exitCode}`);
          }
        }
        state = { offset: stat.size };
      } finally {
        await handle.close();
      }
    } catch (error) {
      console.error(`Error reading events file: ${(error as Error).message}`);
    }

    await saveState(statePath, state);
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.config ?? DEFAULT_CONFIG_PATH);

  const eventsPath = args.events ?? (config.events_path as string | undefined);
  const command = args.command;
  const pollSeconds =
    args.poll ??
    (config.watcher_poll_seconds as number | undefined) ??
    DEFAULT_POLL_SECONDS;
  const statePath =
    args.state ?? (config.watcher_state_path as string | undefined) ?? DEFAULT_STATE_PATH;

  if (!eventsPath) {
    console.error("Error: events_path must be provided via --events or config");
    return 1;
  }

  if (!command) {
    console.error("Error: --command is required");
    return 1;
  }

  await watch(eventsPath, command, pollSeconds, statePath);
  return 0;
}

main().catch((error) => {
  console.error("Fatal error in event watcher:", error);
  process.exit(1);
});
