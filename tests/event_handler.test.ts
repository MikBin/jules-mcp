import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleQuestion,
  handleCompleted,
  handleError,
  handleStuck
} from '../scripts/event_handler.js';
import { execFile } from 'child_process';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

describe('event_handler', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockExecFile = (responseResult: any) => {
    (execFile as any).mockImplementation((cmd, args, opts, callback) => {
      // If callback is not provided (args/opts shifting), handle it?
      // But runMcp calls it with (cmd, args, opts, callback).

      const stdout = JSON.stringify({
        id: 'event-handler',
        result: responseResult,
      });
      // Simulate async callback
      setTimeout(() => callback(null, stdout, ''), 0);

      return {
        stdin: {
          write: vi.fn(),
          end: vi.fn()
        }
      };
    });
  };

  describe('handleQuestion', () => {
    it('should log question details', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = { session_id: 'sess-1', message: { content: 'Is this correct?' } };
      const mcpCommand = ['node', 'mcp.js'];
      const config = {};

      await handleQuestion(event, mcpCommand, config);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[QUESTION] Session sess-1 requires input:'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Is this correct?'));
    });
  });

  describe('handleCompleted', () => {
    it('should call jules_extract_pr_from_session and log PR info', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = { session_id: 'sess-1', state: 'COMPLETED' };
      const mcpCommand = ['node', 'mcp.js'];

      const prInfo = { pullRequest: { url: 'https://github.com/a/b/pull/1' } };
      mockExecFile(prInfo);

      await handleCompleted(event, mcpCommand);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[COMPLETED] Session sess-1 finished with state: COMPLETED'));
      // Verify runMcp called execFile
      expect(execFile).toHaveBeenCalledWith(
        'node',
        ['mcp.js'],
        expect.any(Object),
        expect.any(Function)
      );
      // Verify PR info logged
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('pullRequest'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('https://github.com/a/b/pull/1'));
    });

    it('should skip if no MCP command', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const event = { session_id: 'sess-1', state: 'COMPLETED' };

        await handleCompleted(event, []);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('skipping PR extraction'));
        expect(execFile).not.toHaveBeenCalled();
    });
  });

  describe('handleError', () => {
    it('should log error details', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = { session_id: 'sess-1', state: 'FAILED', message: 'Something broke' };
      const mcpCommand = ['node', 'mcp.js'];

      await handleError(event, mcpCommand);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Session sess-1 failed with state: FAILED'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Something broke'));
    });
  });

  describe('handleStuck', () => {
    it('should call jules_get_session and log info', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = { session_id: 'sess-1', last_activity: 'timestamp' };
      const mcpCommand = ['node', 'mcp.js'];

      const sessionInfo = { state: 'RUNNING' };
      mockExecFile(sessionInfo);

      await handleStuck(event, mcpCommand);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[STUCK] Session sess-1 appears stuck'));
      expect(execFile).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('RUNNING'));
    });
  });
});
