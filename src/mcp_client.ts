import { execFile } from "child_process";

function parseArgs(argv: string[]): {
  command?: string[];
  tool?: string;
  arguments?: string;
} {
  const args: Record<string, string> = {};
  const commandParts: string[] = [];
  let index = 0;

  while (index < argv.length) {
    const entry = argv[index];
    if (entry === "--command") {
      index += 1;
      while (index < argv.length && !argv[index].startsWith("--")) {
        commandParts.push(argv[index]);
        index += 1;
      }
      continue;
    }
    if (entry.startsWith("--")) {
      const key = entry.slice(2);
      const value = argv[index + 1];
      if (value && !value.startsWith("--")) {
        args[key] = value;
        index += 2;
        continue;
      }
      args[key] = "true";
      index += 1;
      continue;
    }
    index += 1;
  }

  return {
    command: commandParts.length > 0 ? commandParts : undefined,
    tool: args.tool,
    arguments: args.arguments,
  };
}

function callTool(
  command: string[],
  tool: string,
  arguments_: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = {
      jsonrpc: "2.0",
      id: "mcp-client",
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
            const response = JSON.parse(line) as Record<string, unknown>;
            if (response.id === "mcp-client") {
              if (response.error) {
                reject(new Error(`MCP error: ${JSON.stringify(response.error)}`));
                return;
              }
              resolve((response.result as Record<string, unknown>) ?? {});
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

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command.length === 0) {
    console.error("Error: --command is required");
    return 1;
  }
  if (!args.tool) {
    console.error("Error: --tool is required");
    return 1;
  }

  let parsedArgs: Record<string, unknown> = {};
  if (args.arguments) {
    try {
      parsedArgs = JSON.parse(args.arguments) as Record<string, unknown>;
    } catch (error) {
      console.error(`Error: Invalid JSON in --arguments: ${(error as Error).message}`);
      return 1;
    }
  }

  try {
    const result = await callTool(args.command, args.tool, parsedArgs);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    return 1;
  }
}

main().catch((error) => {
  console.error("Fatal error in MCP client:", error);
  process.exit(1);
});
