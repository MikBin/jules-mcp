import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isQuestionActivity,
  shouldEmitStuck,
  monitorOnce,
  findActionableActivity,
  sessionStatusUrl,
  sessionActivitiesUrl,
  buildHeaders
} from '../scripts/jules_monitor.js';
import { promises as fs } from 'fs';

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

// Mock fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('jules_monitor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isQuestionActivity', () => {
    it('should return true for activity with agentMessaged containing "?"', () => {
      expect(isQuestionActivity({
        agentMessaged: { agentMessage: 'What do you think?' }
      })).toBe(true);
    });

    it('should return true regardless of case', () => {
      expect(isQuestionActivity({
        agentMessaged: { agentMessage: 'IS THIS OK?' }
      })).toBe(true);
    });

    it('should return false when agentMessaged has no question mark', () => {
      expect(isQuestionActivity({
        agentMessaged: { agentMessage: 'Here is the code.' }
      })).toBe(false);
    });

    it('should return false when agentMessaged is missing', () => {
      expect(isQuestionActivity({ role: 'assistant' })).toBe(false);
    });

    it('should return false when agentMessage is empty', () => {
      expect(isQuestionActivity({
        agentMessaged: { agentMessage: '' }
      })).toBe(false);
    });
  });

  describe('findActionableActivity', () => {
    it('should return the first question activity', () => {
      const activities = [
        { agentMessaged: { agentMessage: 'Done.' } },
        { agentMessaged: { agentMessage: 'Want me to continue?' } },
        { agentMessaged: { agentMessage: 'Another question?' } },
      ];
      expect(findActionableActivity(activities)).toBe(activities[1]);
    });

    it('should return undefined when no question activity exists', () => {
      const activities = [
        { agentMessaged: { agentMessage: 'Done.' } },
      ];
      expect(findActionableActivity(activities)).toBeUndefined();
    });
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

  describe('sessionStatusUrl', () => {
    it('should build correct session status URL', () => {
      expect(sessionStatusUrl('https://api.example.com/v1alpha', 'sess-1'))
        .toBe('https://api.example.com/v1alpha/sessions/sess-1');
    });

    it('should strip trailing slash from apiBase', () => {
      expect(sessionStatusUrl('https://api.example.com/v1alpha/', 'sess-1'))
        .toBe('https://api.example.com/v1alpha/sessions/sess-1');
    });
  });

  describe('sessionActivitiesUrl', () => {
    it('should build correct activities URL without pageToken', () => {
      expect(sessionActivitiesUrl('https://api.example.com/v1alpha', 'sess-1'))
        .toBe('https://api.example.com/v1alpha/sessions/sess-1/activities');
    });

    it('should append pageToken query parameter', () => {
      expect(sessionActivitiesUrl('https://api.example.com/v1alpha', 'sess-1', 'abc123'))
        .toBe('https://api.example.com/v1alpha/sessions/sess-1/activities?pageToken=abc123');
    });

    it('should encode pageToken', () => {
      expect(sessionActivitiesUrl('https://api.example.com/v1alpha', 'sess-1', 'a b=c'))
        .toBe('https://api.example.com/v1alpha/sessions/sess-1/activities?pageToken=a%20b%3Dc');
    });
  });

  describe('buildHeaders', () => {
    it('should include x-goog-api-key when apiKey is provided', () => {
      const headers = buildHeaders('my-key') as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('my-key');
      expect(headers['Accept']).toBe('application/json');
    });

    it('should not include x-goog-api-key when apiKey is undefined', () => {
      const headers = buildHeaders() as Record<string, string>;
      expect(headers['x-goog-api-key']).toBeUndefined();
      expect(headers['Accept']).toBe('application/json');
    });

    it('should not include x-goog-api-key when apiKey is null', () => {
      const headers = buildHeaders(null) as Record<string, string>;
      expect(headers['x-goog-api-key']).toBeUndefined();
    });
  });

  describe('monitorOnce', () => {
    const apiBase = 'https://jules.googleapis.com/v1alpha';
    const apiKey = 'test-api-key';
    const eventsPath = 'events.jsonl';
    const stuckMinutes = 10;

    it('should update state and emit completed event on COMPLETED state', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      // Mock status response: COMPLETED
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ state: 'COMPLETED' }),
      });

      await monitorOnce(jobs, state, apiBase, apiKey, eventsPath, stuckMinutes);

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"event":"completed"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"session_id":"sess-1"'),
        'utf8'
      );
      expect(state['sess-1'].last_status).toBe('COMPLETED');
    });

    it('should emit error event on FAILED state', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ state: 'FAILED' }),
      });

      await monitorOnce(jobs, state, apiBase, apiKey, eventsPath, stuckMinutes);

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"event":"error"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"state":"FAILED"'),
        'utf8'
      );
    });

    it('should emit question event on AWAITING_USER_FEEDBACK state', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ state: 'AWAITING_USER_FEEDBACK' }),
      });

      await monitorOnce(jobs, state, apiBase, apiKey, eventsPath, stuckMinutes);

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"event":"question"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"session_id":"sess-1"'),
        'utf8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"state":"AWAITING_USER_FEEDBACK"'),
        'utf8'
      );
    });

    it('should detect question from activities', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      // Mock status response: RUNNING (not actionable, not AWAITING_USER_FEEDBACK)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ state: 'RUNNING' }),
      });

      // Mock activities response with a question
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          activities: [
            { agentMessaged: { agentMessage: 'Do you want fries with that?' } }
          ],
          nextPageToken: 'page2',
        }),
      });

      await monitorOnce(jobs, state, apiBase, apiKey, eventsPath, stuckMinutes);

      expect(fs.appendFile).toHaveBeenCalledWith(
        eventsPath,
        expect.stringContaining('"event":"question"'),
        'utf8'
      );
      expect(state['sess-1'].cursor).toBe('page2');
    });

    it('should detect stuck jobs', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const state: Record<string, any> = {
        'sess-1': { last_activity: oldTime, last_status: 'RUNNING' }
      };

      // Mock status response: RUNNING
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ state: 'RUNNING' }),
      });

      // Mock activities response (empty)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ activities: [] }),
      });

      await monitorOnce(jobs, state, apiBase, apiKey, eventsPath, stuckMinutes);

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

    it('should pass x-goog-api-key header in fetch calls', async () => {
      const jobs = [{ session_id: 'sess-1' }];
      const state: Record<string, any> = {};

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ state: 'COMPLETED' }),
      });

      await monitorOnce(jobs, state, apiBase, apiKey, eventsPath, stuckMinutes);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sessions/sess-1'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-goog-api-key': 'test-api-key' }),
        }),
      );
    });
  });
});
