#!/usr/bin/env node
/**
 * Jules CLI - Wrapper around the MCP client for easier command-line usage
 * 
 * Usage:
 *   node scripts/jules_cli.js create --owner <owner> --repo <repo> --branch <branch> --prompt "<prompt>" [--title <title>] [--automation-mode <mode>]
 *   node scripts/jules_cli.js get --session-id <id>
 *   node scripts/jules_cli.js list
 *   node scripts/jules_cli.js approve --session-id <id>
 *   node scripts/jules_cli.js monitor --session-id <id> [--interval <seconds>]
 */

import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { getJulesConfig } from "../src/utils.js";

const julesConfig = getJulesConfig();

const MCP_COMMAND = ["node", "build/mcp-server/jules_mcp_server.js"];

function callTool(
  tool: string,
  arguments_: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: "2.0",
      id: "jules-cli",
      method: "tools/call",
      params: { name: tool, arguments: arguments_ },
    };

    const child = execFile(
      MCP_COMMAND[0],
      MCP_COMMAND.slice(1),
      {
        env: {
          ...process.env,
          JULES_API_KEY: julesConfig.apiKey,
          JULES_API_BASE: julesConfig.apiBase,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === "jules-cli") {
              if (response.error) {
                reject(new Error(`MCP error: ${JSON.stringify(response.error)}`));
              } else {
                resolve(response.result ?? {});
              }
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

function parseArgs(argv: string[]): { command?: string; [key: string]: string | undefined } {
  const args: Record<string, string | undefined> = { command: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      args[key] = value;
    } else if (!args.command) {
      args.command = argv[i];
    }
  }
  return args;
}

async function createSession(args: Record<string, string | undefined>) {
  const result = await callTool("jules_create_session", {
    owner: args.owner,
    repo: args.repo,
    branch: args.branch,
    prompt: args.prompt,
    title: args.title,
    requirePlanApproval: args["require-approval"] === "false" ? false : undefined,
    automationMode: args["automation-mode"],
  });
  console.log(JSON.stringify(result, null, 2));
}

async function getSession(args: Record<string, string | undefined>) {
  const result = await callTool("jules_get_session", { session_id: args["session-id"] });
  console.log(JSON.stringify(result, null, 2));
}

async function listSessions() {
  const result = await callTool("jules_list_sessions", {});
  console.log(JSON.stringify(result, null, 2));
}

async function approveSession(args: Record<string, string | undefined>) {
  const result = await callTool("jules_approve_plan", { session_id: args["session-id"] });
  console.log(JSON.stringify(result, null, 2));
}

async function monitorSession(args: Record<string, string | undefined>) {
  const sessionId = args["session-id"];
  const interval = parseInt(args.interval || "120", 10) * 1000;
  
  console.log(`Monitoring session ${sessionId} every ${interval / 1000}s...`);
  
  let lastState = "";
  while (true) {
    const result = await callTool("jules_get_session", { session_id: sessionId });
    const structured = (result as Record<string, unknown>).structuredContent as Record<string, unknown> | undefined;
    
    if (structured) {
      const state = String(structured.state || "");
      const updateTime = structured.updateTime ? new Date(structured.updateTime as string).toLocaleString() : "unknown";
      
      if (state !== lastState) {
        console.log(`[${new Date().toLocaleString()}] State: ${state} (updated: ${updateTime})`);
        lastState = state;
      }
      
      if (state === "COMPLETED" || state === "FAILED") {
        console.log("\n=== SESSION FINISHED ===");
        console.log(JSON.stringify(structured, null, 2));
        
        if (state === "COMPLETED" && Array.isArray(structured.outputs)) {
          const prOutput = (structured.outputs as Record<string, unknown>[]).find((o: Record<string, unknown>) => o.pullRequest);
          if (prOutput) {
            const pr = prOutput.pullRequest as Record<string, unknown>;
            console.log("\n=== PULL REQUEST CREATED ===");
            console.log(`URL: ${pr.url}`);
            console.log(`Title: ${pr.title}`);
          }
        }
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  
  if (!args.command) {
    console.error("Usage: jules_cli <command> [options]");
    console.error("Commands: create, get, list, approve, monitor");
    return 1;
  }
  
  try {
    switch (args.command) {
      case "create":
        await createSession(args);
        break;
      case "get":
        await getSession(args);
        break;
      case "list":
        await listSessions();
        break;
      case "approve":
        await approveSession(args);
        break;
      case "monitor":
        await monitorSession(args);
        break;
      default:
        console.error(`Unknown command: ${args.command}`);
        return 1;
    }
    return 0;
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}