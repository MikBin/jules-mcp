import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildHeaders,
  urlJoin,
  normalizeSessionId,
  compactStatusCodeFromState,
  findCurrentProjectSession,
  createSession,
  getSession,
  listSessions,
  deleteSession,
  sendMessage,
  approvePlan,
  listActivities,
  getActivity,
  listSources,
  getSource,
  wait,
  API_BASE,
  DEFAULT_API_BASE
} from '../mcp-server/jules_mcp_server.js';

// Mock fetch
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('jules_mcp_server', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildHeaders', () => {
    it('should include Accept header', () => {
      const headers = buildHeaders();
      expect(headers).toHaveProperty('Accept', 'application/json');
    });
  });

  describe('urlJoin', () => {
    it('should join base URL and path', () => {
      const base = API_BASE.replace(/\/$/, '');
      expect(urlJoin('sessions')).toBe(`${base}/sessions`);
    });

    it('should handle leading slash in path', () => {
      const base = API_BASE.replace(/\/$/, '');
      expect(urlJoin('/sessions')).toBe(`${base}/sessions`);
    });
  });

  describe('normalizeSessionId', () => {
    it('should keep bare session IDs unchanged', () => {
      expect(normalizeSessionId('abc123')).toBe('abc123');
    });

    it('should strip sessions/ prefix', () => {
      expect(normalizeSessionId('sessions/abc123')).toBe('abc123');
    });
  });

  describe('compactStatusCodeFromState', () => {
    it('should return Q for clarification states', () => {
      expect(compactStatusCodeFromState('AWAITING_USER_FEEDBACK')).toBe('Q');
      expect(compactStatusCodeFromState('AWAITING_PLAN_APPROVAL')).toBe('Q');
    });

    it('should return terminal codes', () => {
      expect(compactStatusCodeFromState('COMPLETED')).toBe('C');
      expect(compactStatusCodeFromState('FAILED')).toBe('F');
    });

    it('should default to N for non-actionable states', () => {
      expect(compactStatusCodeFromState('IN_PROGRESS')).toBe('N');
      expect(compactStatusCodeFromState(undefined)).toBe('N');
    });
  });

  describe('findCurrentProjectSession', () => {
    it('should return the most recent matching project session', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          sessions: [
            {
              name: 'sessions/s-old',
              sourceContext: {
                source: 'sources/github/mikbin/jules-mcp',
                githubRepoContext: { startingBranch: 'main' },
              },
              updateTime: '2026-03-01T10:00:00Z',
            },
            {
              name: 'sessions/s-new',
              sourceContext: {
                source: 'sources/github/mikbin/jules-mcp',
                githubRepoContext: { startingBranch: 'main' },
              },
              updateTime: '2026-03-02T10:00:00Z',
            },
            {
              name: 'sessions/s-other',
              sourceContext: {
                source: 'sources/github/other/repo',
              },
              updateTime: '2026-03-03T10:00:00Z',
            },
          ],
        }),
      });

      const result = await findCurrentProjectSession('mikbin', 'jules-mcp', 'main');
      expect(result).toMatchObject({ name: 'sessions/s-new' });
    });

    it('should return null when no matching session exists', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ sessions: [] }),
      });

      const result = await findCurrentProjectSession('mikbin', 'jules-mcp');
      expect(result).toBeNull();
    });
  });

  describe('API wrappers', () => {
    const mockResponse = (data: any, ok = true, status = 200) => {
      fetchMock.mockResolvedValue({
        ok,
        status,
        text: async () => (data !== null ? JSON.stringify(data) : ''),
      });
    };

    it('createSession should POST to /sessions', async () => {
      mockResponse({ name: 'sessions/s-123' });
      const payload = { prompt: 'do it', sourceContext: {} };

      const result = await createSession(payload);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions$/),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        })
      );
      expect(result).toEqual({ name: 'sessions/s-123' });
    });

    it('getSession should GET /sessions/{id}', async () => {
      mockResponse({ name: 'sessions/s-123', state: 'RUNNING' });

      const result = await getSession('s-123');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions\/s-123$/),
        expect.any(Object)
      );
      expect(result).toEqual({ name: 'sessions/s-123', state: 'RUNNING' });
    });

    it('getSession should accept session path IDs', async () => {
      mockResponse({ name: 'sessions/s-123', state: 'RUNNING' });

      await getSession('sessions/s-123');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions\/s-123$/),
        expect.any(Object)
      );
    });

    it('listSessions should GET /sessions with query params', async () => {
      mockResponse({ sessions: [] });

      await listSessions(10, 'tok-abc');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('pageSize=10'),
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('pageToken=tok-abc'),
        expect.any(Object)
      );
    });

    it('listSessions should GET /sessions without query params when omitted', async () => {
      mockResponse({ sessions: [] });

      await listSessions();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions$/),
        expect.any(Object)
      );
    });

    it('deleteSession should DELETE /sessions/{id}', async () => {
      mockResponse(null, true, 204);

      await deleteSession('s-123');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions\/s-123$/),
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('sendMessage should POST to /sessions/{id}:sendMessage with { prompt } body', async () => {
      mockResponse({ name: 'sessions/s-123/activities/a-1' });

      await sendMessage('s-123', 'hello');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions\/s-123:sendMessage$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ prompt: 'hello' }),
        })
      );
    });

    it('approvePlan should POST to /sessions/{id}:approvePlan', async () => {
      mockResponse({ name: 'sessions/s-123' });

      await approvePlan('s-123');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions\/s-123:approvePlan$/),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        })
      );
    });

    it('listActivities should GET /sessions/{id}/activities', async () => {
      mockResponse({ activities: [] });

      await listActivities('s-123');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions\/s-123\/activities$/),
        expect.any(Object)
      );
    });

    it('listActivities should pass pageSize and pageToken query params', async () => {
      mockResponse({ activities: [] });

      await listActivities('s-123', 5, 'page2');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('pageSize=5'),
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('pageToken=page2'),
        expect.any(Object)
      );
    });

    it('getActivity should GET /sessions/{id}/activities/{activityId}', async () => {
      mockResponse({ name: 'sessions/s-123/activities/a-1' });

      const result = await getActivity('s-123', 'a-1');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sessions\/s-123\/activities\/a-1$/),
        expect.any(Object)
      );
      expect(result).toEqual({ name: 'sessions/s-123/activities/a-1' });
    });

    it('listSources should GET /sources', async () => {
      mockResponse({ sources: [] });

      await listSources();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sources$/),
        expect.any(Object)
      );
    });

    it('listSources should pass pageSize and pageToken query params', async () => {
      mockResponse({ sources: [] });

      await listSources(10, 'tok-xyz');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('pageSize=10'),
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('pageToken=tok-xyz'),
        expect.any(Object)
      );
    });

    it('getSource should GET /sources/{id}', async () => {
      mockResponse({ name: 'sources/src-1' });

      const result = await getSource('src-1');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/sources\/src-1$/),
        expect.any(Object)
      );
      expect(result).toEqual({ name: 'sources/src-1' });
    });

    it('should throw error on non-ok response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      await expect(getSession('invalid-id')).rejects.toThrow('HTTP 404');
    });
  });

  describe('wait', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should resolve after the specified duration', async () => {
      const promise = wait(2);
      vi.advanceTimersByTime(2000);
      await promise;
    });

    it('should clamp to MAX_WAIT_SECONDS (600)', async () => {
      const promise = wait(9999);
      vi.advanceTimersByTime(600_000);
      await promise;
    });

    it('should handle zero seconds', async () => {
      const promise = wait(0);
      vi.advanceTimersByTime(0);
      await promise;
    });

    it('should reject negative values', async () => {
      await expect(wait(-5)).rejects.toThrow('non-negative');
    });

    it('should reject NaN', async () => {
      await expect(wait(NaN)).rejects.toThrow('non-negative finite');
    });

    it('should reject Infinity', async () => {
      await expect(wait(Infinity)).rejects.toThrow('non-negative finite');
    });
  });
});
