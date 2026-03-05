import { describe, it, expect } from 'vitest';
import { formatTimestamp } from '../src/utils.js';

describe('formatTimestamp', () => {
  it('should format a typical ISO string to a human-readable date', () => {
    const input = '2024-01-15T10:30:00Z';
    const expected = 'Jan 15, 2024 at 10:30 AM';
    expect(formatTimestamp(input)).toBe(expected);
  });

  it('should format a different time correctly', () => {
    const input = '2023-11-05T18:45:00Z';
    const expected = 'Nov 5, 2023 at 6:45 PM';
    expect(formatTimestamp(input)).toBe(expected);
  });

  it('should throw an error for invalid timestamps', () => {
    expect(() => formatTimestamp('invalid-date')).toThrow('Invalid timestamp');
  });
});
