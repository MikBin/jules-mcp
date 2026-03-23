import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  monitorOnce,
  shouldEmitStuck,
} from '../scripts/jules_monitor.js';
import { promises as fs } from 'fs';
import { execFile } from 'child_process';

// Mock fs
vi.mock('fs', async () => {
  return {
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      mkdir: vi.fn(),
    }
  };
});

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

describe('jules_monitor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shouldEmitStuck', () => {
    it('should return false if lastActivity is undefined', () => {
      expect(shouldEmitStuck(undefined, 10)).toBe(false);
    });

    it('should return false if lastActivity is invalid date', () => {
      expect(shouldEmitStuck('invalid', 10)).toBe(false);
    });

    it('should return true if elapsed time > threshold', () => {
      const lastActivity = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      expect(shouldEmitStuck(lastActivity, 10)).toBe(true);
    });

    it('should return false if elapsed time < threshold', () => {
      const lastActivity = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(shouldEmitStuck(lastActivity, 10)).toBe(false);
    });
  });

  describe('monitorOnce', () => {
    const mcpCommand = ['node', 'build/mcp-server/jules_mcp_server.js'];
    const eventsPath = 'events.jsonl';
    const stuckMinutes = 10;

    const mockMcpToolResult = (result: any) => {
      (execFile as any).mockImplementation((cmd: string, args: string[], opts: any, callback: any) => {
        setTimeout(() => callback(null, JSON.stringify({
          id: 'jules-monitor',
          result,
        }), ''), 0);
        return {
          stdin: {
            write: vi.fn(),
            end: vi.fn(),
          },
        };
      });
    };

    it('should call jules_check_jules and emit completed event on C', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};
      const writes: string[] = [];

      (execFile as any).mockImplementation((cmd: string, args: string[], opts: any, callback: any) => {
        setTimeout(() => callback(null, JSON.stringify({
          id: 'jules-monitor',
          result: {
            content: [{ type: 'text', text: 'C' }],
            structuredContent: { c: 'C', st: 'COMPLETED', s: 'sess-1' },
          },
        }), ''), 0);
        return {
          stdin: {
            write: (chunk: string) => writes.push(chunk),
            end: vi.fn(),
          },
        };
      });

      await monitorOnce(jobs, state, mcpCommand, eventsPath, stuckMinutes);

      const request = JSON.parse(writes[0]);
      expect(request.params.name).toBe('jules_check_jules');
      expect(request.params.arguments).toEqual({ session_id: 'sess-1' });

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"event":"completed"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"check_code":"C"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"session_id":"sess-1"'),
        'utf8'
      );
      expect(state['session:sess-1'].last_status).toBe('C');
    });

    it('should emit question event on Q', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      mockMcpToolResult({
        content: [{ type: 'text', text: 'Q' }],
        structuredContent: { c: 'Q', st: 'AWAITING_USER_FEEDBACK', s: 'sess-1' },
      });

      await monitorOnce(jobs, state, mcpCommand, eventsPath, stuckMinutes);

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"event":"question"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"check_code":"Q"'),
        'utf8'
      );
    });

    it('should emit error event on F', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      mockMcpToolResult({
        content: [{ type: 'text', text: 'F' }],
        structuredContent: { c: 'F', st: 'FAILED', s: 'sess-1' },
      });

      await monitorOnce(jobs, state, mcpCommand, eventsPath, stuckMinutes);

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"event":"error"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"check_code":"F"'),
        'utf8'
      );
    });

    it('should not emit an event on N unless stuck', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      mockMcpToolResult({
        content: [{ type: 'text', text: 'N' }],
        structuredContent: { c: 'N', st: 'IN_PROGRESS', s: 'sess-1' },
      });

      await monitorOnce(jobs, state, mcpCommand, eventsPath, stuckMinutes);

      expect(fs.appendFile).not.toHaveBeenCalled();
    });

    it('should detect stuck jobs', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const state: Record<string, any> = {
        'session:sess-1': { last_activity: oldTime, last_status: 'N', session_id: 'sess-1' }
      };

      mockMcpToolResult({
        content: [{ type: 'text', text: 'N' }],
        structuredContent: { c: 'N', st: 'IN_PROGRESS', s: 'sess-1' },
      });

      await monitorOnce(jobs, state, mcpCommand, eventsPath, stuckMinutes);

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"event":"stuck"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"session_id":"sess-1"'),
        'utf8'
      );
    });

    it('should support project-scoped jobs (owner/repo/branch)', async () => {
      const jobs = [{ owner: 'mikbin', repo: 'jules-mcp', branch: 'main' }];
      const state: Record<string, any> = {};
      const writes: string[] = [];

      (execFile as any).mockImplementation((cmd: string, args: string[], opts: any, callback: any) => {
        setTimeout(() => callback(null, JSON.stringify({
          id: 'jules-monitor',
          result: {
            content: [{ type: 'text', text: 'N' }],
            structuredContent: { c: 'N', st: 'IN_PROGRESS', s: 'sess-42' },
          },
        }), ''), 0);
        return {
          stdin: {
            write: (chunk: string) => writes.push(chunk),
            end: vi.fn(),
          },
        };
      });

      await monitorOnce(jobs, state, mcpCommand, eventsPath, stuckMinutes);

      const request = JSON.parse(writes[0]);
      expect(request.params.arguments).toEqual({ owner: 'mikbin', repo: 'jules-mcp', branch: 'main' });
      expect(state['project:mikbin/jules-mcp#main'].session_id).toBe('sess-42');
    });

    it('should emit error when check tool call fails', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      (execFile as any).mockImplementation((cmd: string, args: string[], opts: any, callback: any) => {
        setTimeout(() => callback(new Error('boom'), '', 'mcp failed'), 0);
        return {
          stdin: {
            write: vi.fn(),
            end: vi.fn(),
          },
        };
      });

      await monitorOnce(jobs, state, mcpCommand, eventsPath, stuckMinutes);

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('jules_check_jules failed'),
        'utf8'
      );
    });
  });
});
