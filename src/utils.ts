import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Attempts to retrieve Jules API configuration from environment variables or
 * common MCP configuration files (e.g. Antigravity, Cline).
 */
export function getJulesConfig(): { apiKey?: string; apiBase?: string } {
  if (process.env.JULES_API_KEY) {
    return {
      apiKey: process.env.JULES_API_KEY,
      apiBase: process.env.JULES_API_BASE,
    };
  }

  const home = os.homedir();
  const configPaths = [
    path.join(home, ".gemini", "antigravity", "mcp_config.json"),
    path.join(home, ".cline", "cline_mcp_settings.json"),
    path.join(home, ".cline", "mcp_config.json"),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        const julesServer = config.mcpServers?.["jules-mcp-server"];
        if (julesServer?.env?.JULES_API_KEY) {
          return {
            apiKey: julesServer.env.JULES_API_KEY,
            apiBase: julesServer.env.JULES_API_BASE,
          };
        }
      }
    } catch (e) {
      // Ignore parse or read errors
    }
  }

  return {};
}

/**
 * Converts an ISO date string to a human-readable format.
 * Example: '2024-01-15T10:30:00Z' -> 'Jan 15, 2024 at 10:30 AM'
 *
 * @param isoString The ISO date string to convert.
 * @returns The formatted date string.
 */
export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);

  if (isNaN(date.getTime())) {
    throw new Error('Invalid timestamp');
  }

  // Formatting options
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC' // Explicitly use UTC to ensure consistent output as requested
  });

  const parts = formatter.formatToParts(date);

  let month = '';
  let day = '';
  let year = '';
  let hour = '';
  let minute = '';
  let dayPeriod = '';

  for (const part of parts) {
    switch (part.type) {
      case 'month': month = part.value; break;
      case 'day': day = part.value; break;
      case 'year': year = part.value; break;
      case 'hour': hour = part.value; break;
      case 'minute': minute = part.value; break;
      case 'dayPeriod': dayPeriod = part.value; break;
    }
  }

  return `${month} ${day}, ${year} at ${hour}:${minute} ${dayPeriod}`;
}
