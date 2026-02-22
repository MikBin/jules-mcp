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
      const event = { job_id: 'job-1', message: { content: 'Is this correct?' } };
      const mcpCommand = ['node', 'mcp.js'];

      await handleQuestion(event, mcpCommand);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[QUESTION] Job job-1'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Is this correct?'));
    });
  });

  describe('handleCompleted', () => {
    it('should call jules_get_artifacts and log artifacts', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = { job_id: 'job-1', status: 'COMPLETED' };
      const mcpCommand = ['node', 'mcp.js'];

      const artifacts = { diff: 'some-diff' };
      mockExecFile(artifacts);

      await handleCompleted(event, mcpCommand);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[COMPLETED] Job job-1'));
      // Verify runMcp called execFile
      expect(execFile).toHaveBeenCalledWith(
        'node',
        ['mcp.js'],
        expect.any(Object),
        expect.any(Function)
      );
      // Verify artifacts logged
      // Since mockExecFile uses setTimeout, we need to wait for promise resolution?
      // handleCompleted awaits runMcp, which awaits the callback. So it should be fine.
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('some-diff'));
    });

    it('should skip if no MCP command', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const event = { job_id: 'job-1', status: 'COMPLETED' };

        await handleCompleted(event, []);

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('skipping artifact fetch'));
        expect(execFile).not.toHaveBeenCalled();
    });
  });

  describe('handleError', () => {
    it('should log error details', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = { job_id: 'job-1', status: 'FAILED', message: 'Something broke' };
      const mcpCommand = ['node', 'mcp.js'];

      await handleError(event, mcpCommand);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR] Job job-1'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Something broke'));
    });
  });

  describe('handleStuck', () => {
    it('should call jules_get_job and log info', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const event = { job_id: 'job-1', last_activity: 'timestamp' };
      const mcpCommand = ['node', 'mcp.js'];

      const jobInfo = { status: 'RUNNING' };
      mockExecFile(jobInfo);

      await handleStuck(event, mcpCommand);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[STUCK] Job job-1'));
      expect(execFile).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('RUNNING'));
    });
  });
});
