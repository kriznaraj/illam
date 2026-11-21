import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivityTrackerEvent } from '@/types';

const FIXED_TODAY = '2026-08-15';

const { familyRepo, occurrenceRepo } = vi.hoisted(() => ({
  familyRepo: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findById: vi.fn(),
    findFiltered: vi.fn(),
    findOpenAnnualPastDue: vi.fn(),
  },
  occurrenceRepo: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findById: vi.fn(),
    findByEventId: vi.fn(),
    findByEventIdAndDate: vi.fn(),
  },
}));

// Returning an object from a constructor replaces `this`, so the service's
// `new ActivityTrackerRepository(supabase)` hands back the mock.
vi.mock('../../repositories/ActivityTrackerRepository', () => ({
  ActivityTrackerRepository: class {
    constructor() {
      return familyRepo as any;
    }
  },
}));
vi.mock('../../repositories/ActivityTrackerOccurrenceRepository', () => ({
  ActivityTrackerOccurrenceRepository: class {
    constructor() {
      return occurrenceRepo as any;
    }
  },
}));

// Pin "today" so date-dependent rules are deterministic. Everything else in
// dateUtils stays real — the app timezone logic is what we want exercised.
vi.mock('../../utils/dateUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dateUtils')>();
  return { ...actual, getTodayAppDate: () => FIXED_TODAY };
});

import { ActivityTrackerService } from '../ActivityTrackerService';

const EVENT_ID = '123e4567-e89b-12d3-a456-426614174000';

const makeEvent = (over: Partial<ActivityTrackerEvent> = {}): ActivityTrackerEvent =>
  ({
    id: EVENT_ID,
    title: 'Gym',
    description: null,
    event_type: 'activity',
    event_date: '2026-01-01',
    status: 'open',
    reminder_days_before: 0,
    series_id: null,
    notes: null,
    ...over,
  }) as ActivityTrackerEvent;

let service: ActivityTrackerService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  service = new ActivityTrackerService({} as any);
});

describe('create', () => {
  it('requires title, type and date', async () => {
    await expect(
      service.create({ title: '', event_type: 'activity', event_date: '2026-01-01' })
    ).rejects.toThrow('title is required');
  });

  it('rejects an unparseable event date', async () => {
    await expect(
      service.create({ title: 'Gym', event_type: 'activity', event_date: 'someday' })
    ).rejects.toThrow('Event date must be a valid date');
  });

  it('trims the title and description', async () => {
    familyRepo.create.mockResolvedValue(makeEvent());
    await service.create({
      title: '  Gym  ',
      description: '  evening  ',
      event_type: 'activity',
      event_date: '2026-01-01',
    });
    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Gym', description: 'evening' })
    );
  });

  it('stores an empty description as null', async () => {
    familyRepo.create.mockResolvedValue(makeEvent());
    await service.create({
      title: 'Gym',
      description: '   ',
      event_type: 'activity',
      event_date: '2026-01-01',
    });
    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ description: null })
    );
  });

  it('opens every new event', async () => {
    familyRepo.create.mockResolvedValue(makeEvent());
    await service.create({ title: 'Gym', event_type: 'activity', event_date: '2026-01-01' });
    expect(familyRepo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }));
  });

  it('defaults an annual reminder to 7 days', async () => {
    familyRepo.create.mockResolvedValue(makeEvent({ event_type: 'annual', series_id: EVENT_ID }));
    await service.create({ title: 'Birthday', event_type: 'annual', event_date: '2026-09-01' });
    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ reminder_days_before: 7 })
    );
  });

  it('respects an explicit annual reminder window', async () => {
    familyRepo.create.mockResolvedValue(makeEvent({ event_type: 'annual', series_id: EVENT_ID }));
    await service.create({
      title: 'Birthday',
      event_type: 'annual',
      event_date: '2026-09-01',
      reminder_days_before: 30,
    });
    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ reminder_days_before: 30 })
    );
  });

  it('forces a zero reminder on non-annual events', async () => {
    familyRepo.create.mockResolvedValue(makeEvent());
    await service.create({
      title: 'Gym',
      event_type: 'activity',
      event_date: '2026-01-01',
      reminder_days_before: 30,
    });
    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ reminder_days_before: 0 })
    );
  });

  it('backfills series_id to the row id when the trigger did not', async () => {
    // series_id is annual-only and normally defaulted by a DB trigger; the
    // service repairs it so the year-by-year trail is never broken.
    familyRepo.create.mockResolvedValue(makeEvent({ event_type: 'annual', series_id: null }));
    familyRepo.update.mockResolvedValue(makeEvent({ event_type: 'annual', series_id: EVENT_ID }));

    const result = await service.create({
      title: 'Birthday',
      event_type: 'annual',
      event_date: '2026-09-01',
    });

    expect(familyRepo.update).toHaveBeenCalledWith(EVENT_ID, { series_id: EVENT_ID });
    expect(result.series_id).toBe(EVENT_ID);
  });

  it('leaves series_id alone when the trigger already set it', async () => {
    familyRepo.create.mockResolvedValue(makeEvent({ event_type: 'annual', series_id: EVENT_ID }));
    await service.create({ title: 'Birthday', event_type: 'annual', event_date: '2026-09-01' });
    expect(familyRepo.update).not.toHaveBeenCalled();
  });

  it('nulls series_id for non-annual events', async () => {
    familyRepo.create.mockResolvedValue(makeEvent());
    await service.create({ title: 'Trip', event_type: 'one_time', event_date: '2026-01-01' });
    expect(familyRepo.create).toHaveBeenCalledWith(expect.objectContaining({ series_id: null }));
    expect(familyRepo.update).not.toHaveBeenCalled();
  });
});

describe('close / reopen', () => {
  it.each(['activity', 'one_time'] as const)('closes a %s event', async (type) => {
    familyRepo.findById.mockResolvedValue(makeEvent({ event_type: type }));
    familyRepo.update.mockResolvedValue(makeEvent({ event_type: type, status: 'closed' }));
    await service.close(EVENT_ID);
    expect(familyRepo.update).toHaveBeenCalledWith(EVENT_ID, { status: 'closed' });
  });

  it('reopens an activity, preserving its logs', async () => {
    familyRepo.findById.mockResolvedValue(makeEvent({ status: 'closed' }));
    familyRepo.update.mockResolvedValue(makeEvent({ status: 'open' }));
    await service.reopen(EVENT_ID);
    expect(familyRepo.update).toHaveBeenCalledWith(EVENT_ID, { status: 'open' });
  });

  it('refuses to close an annual event', async () => {
    // Annual events are advanced by advanceAnnualEvents(), never by hand.
    familyRepo.findById.mockResolvedValue(makeEvent({ event_type: 'annual' }));
    await expect(service.close(EVENT_ID)).rejects.toThrow('Annual events cannot be closed manually');
    expect(familyRepo.update).not.toHaveBeenCalled();
  });

  it('refuses to reopen an annual event', async () => {
    familyRepo.findById.mockResolvedValue(makeEvent({ event_type: 'annual', status: 'closed' }));
    await expect(service.reopen(EVENT_ID)).rejects.toThrow('Annual events cannot be reopened');
    expect(familyRepo.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed id before hitting the database', async () => {
    await expect(service.close('not-a-uuid')).rejects.toThrow('Event ID must be a valid UUID');
    expect(familyRepo.findById).not.toHaveBeenCalled();
  });

  it('reports a missing event', async () => {
    familyRepo.findById.mockResolvedValue(null);
    await expect(service.close(EVENT_ID)).rejects.toThrow('Event not found');
  });
});

describe('logOccurrence', () => {
  it('logs against an open activity', async () => {
    familyRepo.findById.mockResolvedValue(makeEvent());
    occurrenceRepo.findByEventIdAndDate.mockResolvedValue(null);
    occurrenceRepo.create.mockResolvedValue({ id: 'occ-1' });

    await service.logOccurrence(EVENT_ID, '2026-08-10', '  did it  ');

    expect(occurrenceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: EVENT_ID,
        occurred_at: '2026-08-10',
        comment: 'did it',
      })
    );
  });

  it('defaults the date to today in the app timezone', async () => {
    familyRepo.findById.mockResolvedValue(makeEvent());
    occurrenceRepo.findByEventIdAndDate.mockResolvedValue(null);
    occurrenceRepo.create.mockResolvedValue({ id: 'occ-1' });

    await service.logOccurrence(EVENT_ID);

    expect(occurrenceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ occurred_at: FIXED_TODAY })
    );
  });

  it('stores a blank comment as null', async () => {
    familyRepo.findById.mockResolvedValue(makeEvent());
    occurrenceRepo.findByEventIdAndDate.mockResolvedValue(null);
    occurrenceRepo.create.mockResolvedValue({ id: 'occ-1' });

    await service.logOccurrence(EVENT_ID, '2026-08-10', '   ');

    expect(occurrenceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ comment: null })
    );
  });

  it.each(['annual', 'one_time'] as const)('refuses to log against a %s event', async (type) => {
    familyRepo.findById.mockResolvedValue(makeEvent({ event_type: type }));
    await expect(service.logOccurrence(EVENT_ID)).rejects.toThrow(
      'Only activity events can log occurrences'
    );
    expect(occurrenceRepo.create).not.toHaveBeenCalled();
  });

  it('refuses to log against a closed activity', async () => {
    familyRepo.findById.mockResolvedValue(makeEvent({ status: 'closed' }));
    await expect(service.logOccurrence(EVENT_ID)).rejects.toThrow(
      'Cannot modify occurrences on a closed activity'
    );
  });

  it('rejects a second log for the same date', async () => {
    // Mirrors the DB unique constraint, which surfaces as HTTP 409.
    familyRepo.findById.mockResolvedValue(makeEvent());
    occurrenceRepo.findByEventIdAndDate.mockResolvedValue({ id: 'occ-1' });

    await expect(service.logOccurrence(EVENT_ID, '2026-08-10')).rejects.toThrow(
      'Already logged for this date'
    );
    expect(occurrenceRepo.create).not.toHaveBeenCalled();
  });

  it('words the duplicate message for today differently', async () => {
    familyRepo.findById.mockResolvedValue(makeEvent());
    occurrenceRepo.findByEventIdAndDate.mockResolvedValue({ id: 'occ-1' });

    await expect(service.logOccurrence(EVENT_ID, FIXED_TODAY)).rejects.toThrow(
      'Already logged for today'
    );
  });
});

describe('advanceAnnualEvents', () => {
  it('does nothing when no annual event is past due', async () => {
    familyRepo.findOpenAnnualPastDue.mockResolvedValue([]);
    await service.advanceAnnualEvents();
    expect(familyRepo.update).not.toHaveBeenCalled();
    expect(familyRepo.create).not.toHaveBeenCalled();
  });

  it('closes the past-due row and opens next year in the same series', async () => {
    familyRepo.findOpenAnnualPastDue.mockResolvedValue([
      makeEvent({
        event_type: 'annual',
        event_date: '2026-03-10',
        reminder_days_before: 7,
        series_id: 'series-1',
      }),
    ]);

    await service.advanceAnnualEvents();

    expect(familyRepo.update).toHaveBeenCalledWith(EVENT_ID, { status: 'closed' });
    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'annual',
        event_date: '2027-03-10',
        status: 'open',
        reminder_days_before: 7,
        series_id: 'series-1',
      })
    );
  });

  it('rolls forward repeatedly until the date is in the future', async () => {
    // An event untouched for years must land on the next upcoming date,
    // not merely one year on from a long-past one.
    familyRepo.findOpenAnnualPastDue.mockResolvedValue([
      makeEvent({ event_type: 'annual', event_date: '2023-03-10', series_id: 'series-1' }),
    ]);

    await service.advanceAnnualEvents();

    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ event_date: '2027-03-10' })
    );
  });

  it('seeds series_id from the row id when the row has none', async () => {
    familyRepo.findOpenAnnualPastDue.mockResolvedValue([
      makeEvent({ event_type: 'annual', event_date: '2026-03-10', series_id: null }),
    ]);

    await service.advanceAnnualEvents();

    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ series_id: EVENT_ID })
    );
  });

  it('carries the title, description and notes onto the new row', async () => {
    familyRepo.findOpenAnnualPastDue.mockResolvedValue([
      makeEvent({
        event_type: 'annual',
        event_date: '2026-03-10',
        title: 'Amma birthday',
        description: 'call in the morning',
        notes: 'gift ideas',
        series_id: 'series-1',
      }),
    ]);

    await service.advanceAnnualEvents();

    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Amma birthday',
        description: 'call in the morning',
        notes: 'gift ideas',
      })
    );
  });

  it('keeps advancing the rest when one event fails', async () => {
    familyRepo.findOpenAnnualPastDue.mockResolvedValue([
      makeEvent({ id: 'bad-id', event_type: 'annual', event_date: '2026-03-10' }),
      makeEvent({ id: 'good-id', event_type: 'annual', event_date: '2026-04-10' }),
    ]);
    familyRepo.update.mockRejectedValueOnce(new Error('write failed'));

    await service.advanceAnnualEvents();

    expect(familyRepo.update).toHaveBeenCalledTimes(2);
    expect(familyRepo.create).toHaveBeenCalledTimes(1);
    expect(familyRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ event_date: '2027-04-10' })
    );
  });

  it('never throws — it runs lazily inside a GET and must not fail the request', async () => {
    familyRepo.findOpenAnnualPastDue.mockRejectedValue(new Error('db down'));
    await expect(service.advanceAnnualEvents()).resolves.toBeUndefined();
  });
});

describe('getFiltered / getOccurrences', () => {
  it('passes filters through to the repository', async () => {
    familyRepo.findFiltered.mockResolvedValue([]);
    await service.getFiltered({ event_type: 'activity', status: 'open' });
    expect(familyRepo.findFiltered).toHaveBeenCalledWith({
      event_type: 'activity',
      status: 'open',
    });
  });

  it('validates the event id before fetching occurrences', async () => {
    await expect(service.getOccurrences('nope')).rejects.toThrow('Event ID must be a valid UUID');
    expect(occurrenceRepo.findByEventId).not.toHaveBeenCalled();
  });
});
