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
