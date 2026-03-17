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

export async function handleQuestion(event: JsonRecord, mcpCommand: MCPCommand, config: JsonRecord): Promise<void> {
  const sessionId = event.session_id ?? "unknown";
  const message = event.message ?? {};
  const content = (message as JsonRecord).content ?? JSON.stringify(message);
  const state = event.state ?? "";

  console.error(`[QUESTION] Session ${sessionId} requires input:`);
  console.error(`  State: ${state}`);
  console.error(`  ${content}`);

  if (mcpCommand.length === 0) {
    console.error("  (No MCP command configured - skipping response)");
    return;
  }

  // Check if auto-approve is enabled in config
  const autoApprove = config.auto_approve_plans === true;
  
  if (autoApprove && state === "AWAITING_USER_FEEDBACK") {
    console.error(`  Auto-approving plan for session ${sessionId}...`);
    try {
      const result = await runMcp(mcpCommand, "jules_approve_plan", {
        session_id: sessionId,
      });
      console.error(`  Plan approved: ${JSON.stringify(result, null, 2)}`);
    } catch (error) {
      console.error(`  Failed to approve plan: ${(error as Error).message}`);
    }
  } else {
    console.error("  Plan approval is manual. Use Cline to call jules_approve_plan when ready.");
  }
}

export async function handleCompleted(event: JsonRecord, mcpCommand: MCPCommand): Promise<void> {
  const sessionId = event.session_id ?? "unknown";
  const state = event.state ?? "UNKNOWN";

  console.error(`[COMPLETED] Session ${sessionId} finished with state: ${state}`);

  if (mcpCommand.length === 0) {
    console.error("  (No MCP command configured - skipping PR extraction)");
    return;
  }

  try {
    const prInfo = await runMcp(mcpCommand, "jules_extract_pr_from_session", {
      session_id: sessionId,
    });
    console.error(`  PR info: ${JSON.stringify(prInfo, null, 2)}`);
  } catch (error) {
    console.error(`  Failed to extract PR: ${(error as Error).message}`);
  }
}

export async function handleError(event: JsonRecord, mcpCommand: MCPCommand): Promise<void> {
  const sessionId = event.session_id ?? "unknown";
  const state = event.state ?? "UNKNOWN";
  const message = event.message ?? "No error details available";

  console.error(`[ERROR] Session ${sessionId} failed with state: ${state}`);
  console.error(`  Error: ${message}`);

  if (mcpCommand.length === 0) {
    console.error("  (No MCP command configured - skipping investigation)");
    return;
  }

  try {
    const sessionInfo = await runMcp(mcpCommand, "jules_get_session", {
      session_id: sessionId,
    });
    console.error(`  Session info: ${JSON.stringify(sessionInfo, null, 2)}`);
  } catch (error) {
    console.error(`  Failed to get session: ${(error as Error).message}`);
  }
}

export async function handleStuck(event: JsonRecord, mcpCommand: MCPCommand): Promise<void> {
  const sessionId = event.session_id ?? "unknown";
  const lastActivity = event.last_activity ?? "unknown";

  console.error(`[STUCK] Session ${sessionId} appears stuck`);
  console.error(`  Last activity: ${lastActivity}`);

  if (mcpCommand.length === 0) {
    console.error("  (No MCP command configured - skipping investigation)");
    return;
  }

  try {
    const sessionInfo = await runMcp(mcpCommand, "jules_get_session", {
      session_id: sessionId,
    });
    console.error(`  Session info: ${JSON.stringify(sessionInfo, null, 2)}`);
  } catch (error) {
    console.error(`  Failed to get session: ${(error as Error).message}`);
  }
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
  const sessionId = event.session_id ?? "unknown";
  console.error(`--- Processing ${eventType} event for session ${sessionId} ---`);

  if (eventType === "question") {
    await handleQuestion(event, mcpCommand, config);
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
