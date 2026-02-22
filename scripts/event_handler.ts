import { execFile } from "child_process";
import { dirname } from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

const DEFAULT_CONFIG_PATH = process.env.JULES_CONFIG ?? "jules-manager/config.json";

type JsonRecord = Record<string, unknown>;

type MCPCommand = string[];

async function loadEvent(): Promise<JsonRecord> {
  const raw = process.env.JULES_EVENT;
  if (!raw) {
    throw new Error("JULES_EVENT environment variable is not set");
  }
  return JSON.parse(raw) as JsonRecord;
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

async function runMcp(
  command: MCPCommand,
  tool: string,
  arguments_: JsonRecord
): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: "2.0",
      id: "event-handler",
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
            if (response.id === "event-handler") {
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

export async function handleQuestion(event: JsonRecord, mcpCommand: MCPCommand): Promise<void> {
  const jobId = event.job_id ?? "unknown";
  const message = event.message ?? {};
  const content = (message as JsonRecord).content ?? JSON.stringify(message);

  console.error(`[QUESTION] Job ${jobId} requires input:`);
  console.error(`  ${content}`);

  if (mcpCommand.length === 0) {
    console.error("  (No MCP command configured - skipping response)");
    return;
  }
}

export async function handleCompleted(event: JsonRecord, mcpCommand: MCPCommand): Promise<void> {
  const jobId = event.job_id ?? "unknown";
  const status = event.status ?? "UNKNOWN";

  console.error(`[COMPLETED] Job ${jobId} finished with status: ${status}`);

  if (mcpCommand.length === 0) {
    console.error("  (No MCP command configured - skipping artifact fetch)");
    return;
  }

  const artifacts = await runMcp(mcpCommand, "jules_get_artifacts", {
    job_id: jobId,
  });
  console.error(`  Artifacts: ${JSON.stringify(artifacts, null, 2)}`);
}

export async function handleError(event: JsonRecord, mcpCommand: MCPCommand): Promise<void> {
  const jobId = event.job_id ?? "unknown";
  const status = event.status ?? "UNKNOWN";
  const message = event.message ?? "No error details available";

  console.error(`[ERROR] Job ${jobId} failed with status: ${status}`);
  console.error(`  Error: ${message}`);

  if (mcpCommand.length === 0) {
    console.error("  (No MCP command configured - skipping retry)");
    return;
  }
}

export async function handleStuck(event: JsonRecord, mcpCommand: MCPCommand): Promise<void> {
  const jobId = event.job_id ?? "unknown";
  const lastActivity = event.last_activity ?? "unknown";

  console.error(`[STUCK] Job ${jobId} appears stuck`);
  console.error(`  Last activity: ${lastActivity}`);

  if (mcpCommand.length === 0) {
    console.error("  (No MCP command configured - skipping investigation)");
    return;
  }

  const jobInfo = await runMcp(mcpCommand, "jules_get_job", { job_id: jobId });
  console.error(`  Job info: ${JSON.stringify(jobInfo, null, 2)}`);
}

function parseMcpCommand(configValue: unknown): MCPCommand {
  if (Array.isArray(configValue)) {
    return configValue.map(String);
  }
  if (typeof configValue === "string") {
    return [configValue];
  }
  return [];
}

function formatLog(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

async function main(): Promise<number> {
  const event = await loadEvent();
  const config = await loadConfig(DEFAULT_CONFIG_PATH);
  const mcpCommand = parseMcpCommand(config.mcp_command);

  const eventType = event.event ?? "unknown";
  const jobId = event.job_id ?? "unknown";
  console.error(`--- Processing ${eventType} event for job ${jobId} ---`);

  if (eventType === "question") {
    await handleQuestion(event, mcpCommand);
    return 0;
  }

  if (eventType === "completed") {
    await handleCompleted(event, mcpCommand);
    return 0;
  }

  if (eventType === "error") {
    await handleError(event, mcpCommand);
    return 0;
  }

  if (eventType === "stuck") {
    await handleStuck(event, mcpCommand);
    return 0;
  }

  console.error(`[UNKNOWN] Unhandled event type: ${eventType}`);
  console.error(`  Event data: ${formatLog(event)}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Fatal error in event handler:", error);
    process.exit(1);
  });
}
