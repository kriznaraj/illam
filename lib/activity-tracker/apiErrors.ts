export function mapOccurrenceApiError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : fallback;

  if (raw.startsWith('Already logged')) {
    return { message: raw, status: 409 as const };
  }

  if (
    raw.includes('family_tracker_occurrences_event_id_occurred_at_key') ||
    raw.includes('duplicate key value violates unique constraint')
  ) {
    return { message: 'Already logged for this date', status: 409 as const };
  }

  if (raw.startsWith('Failed to create family_tracker_occurrences')) {
    return { message: fallback, status: 500 as const };
  }

  return { message: raw, status: 500 as const };
}
