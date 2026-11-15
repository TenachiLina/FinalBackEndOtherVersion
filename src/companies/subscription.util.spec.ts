import {
  addDays,
  addMonths,
  endOfDay,
  extendedEnd,
  isIsoDate,
  startOfDay,
  subscriptionState,
} from './subscription.util';

const NOW = new Date('2026-11-14T10:00:00.000Z');
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

describe('subscriptionState', () => {
  it('a company without a subscription has no limit and no end', () => {
    for (const none of [null, undefined, {}, { status: 'active' }]) {
      expect(subscriptionState(none, NOW)).toEqual({
        status: 'none',
        kind: null,
        packName: null,
        endsAt: null,
        daysLeft: null,
        endingSoon: false,
        readOnly: false,
        maxEmployees: null,
      });
    }
  });

  it('an unreadable end date counts as no subscription', () => {
    expect(subscriptionState({ endsAt: 'soon' }, NOW).status).toBe('none');
  });

  it('a paid period with more than 7 days left shows nothing', () => {
    expect(
      subscriptionState(
        {
          status: 'active',
          endsAt: inDays(30),
          packName: 'Pro',
          maxEmployees: 50,
        },
        NOW,
      ),
    ).toEqual({
      status: 'active',
      kind: 'active',
      packName: 'Pro',
      endsAt: inDays(30),
      daysLeft: 30,
      endingSoon: false,
      readOnly: false,
      maxEmployees: 50,
    });
  });

  it('warns from 7 days before the end', () => {
    expect(subscriptionState({ endsAt: inDays(8) }, NOW).endingSoon).toBe(
      false,
    );
    expect(subscriptionState({ endsAt: inDays(7) }, NOW)).toMatchObject({
      endingSoon: true,
      daysLeft: 7,
      readOnly: false,
    });
    expect(subscriptionState({ endsAt: inDays(0.5) }, NOW)).toMatchObject({
      endingSoon: true,
      daysLeft: 0,
      readOnly: false,
    });
  });

  it('is read-only once the end date has passed', () => {
    const state = subscriptionState(
      { status: 'active', endsAt: new Date(NOW.getTime() - 1) },
      NOW,
    );
    expect(state).toMatchObject({
      status: 'expired',
      kind: 'active',
      readOnly: true,
      endingSoon: false,
      daysLeft: 0,
    });
  });

  it('still runs at the very end moment', () => {
    expect(subscriptionState({ endsAt: NOW }, NOW)).toMatchObject({
      status: 'active',
      readOnly: false,
    });
  });

  it('tells a trial from a paid period, also after it ended', () => {
    expect(
      subscriptionState({ status: 'trial', endsAt: inDays(10) }, NOW),
    ).toMatchObject({ status: 'trial', kind: 'trial' });
    expect(
      subscriptionState({ status: 'trial', endsAt: inDays(-1) }, NOW),
    ).toMatchObject({ status: 'expired', kind: 'trial', readOnly: true });
  });

  it('reads an end date given as text', () => {
    expect(
      subscriptionState({ endsAt: '2026-12-14T10:00:00.000Z' }, NOW).daysLeft,
    ).toBe(30);
  });

  it('0, a negative or a missing employee limit means no limit', () => {
    for (const maxEmployees of [0, -5, null, undefined]) {
      expect(
        subscriptionState({ endsAt: inDays(30), maxEmployees }, NOW)
          .maxEmployees,
      ).toBeNull();
    }
  });
});

describe('dates', () => {
  it('isIsoDate accepts real calendar days only', () => {
    expect(isIsoDate('2026-11-14')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '14/11/2026',
      '',
      null,
      20261114,
    ]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });

  it('a subscription runs from the first to the last moment of its days', () => {
    expect(startOfDay('2026-11-14').toISOString()).toBe(
      '2026-11-14T00:00:00.000Z',
    );
    expect(endOfDay('2026-11-14').toISOString()).toBe(
      '2026-11-14T23:59:59.999Z',
    );
  });

  it('addDays', () => {
    expect(addDays(new Date('2026-11-14T00:00:00Z'), 14).toISOString()).toBe(
      '2026-11-28T00:00:00.000Z',
    );
  });

  it('addMonths keeps the day of the month', () => {
    expect(
      addMonths(new Date('2026-11-14T23:59:59.999Z'), 1).toISOString(),
    ).toBe('2026-12-14T23:59:59.999Z');
    expect(addMonths(new Date('2026-11-14T00:00:00Z'), 12).toISOString()).toBe(
      '2027-11-14T00:00:00.000Z',
    );
  });

  it('addMonths stops at the last day of a shorter month', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addMonths(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(addMonths(new Date('2026-10-31T00:00:00Z'), 4).toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
  });
});

describe('extendedEnd', () => {
  it('adds the months after the current end while the subscription runs', () => {
    expect(
      extendedEnd(new Date('2026-12-01T23:59:59.999Z'), 3, NOW).toISOString(),
    ).toBe('2027-03-01T23:59:59.999Z');
  });

  it('starts from today when the subscription has already ended', () => {
    expect(
      extendedEnd(new Date('2026-10-01T00:00:00Z'), 1, NOW).toISOString(),
    ).toBe('2026-12-14T10:00:00.000Z');
  });

  it('starts from today without a current end', () => {
    expect(extendedEnd(null, 2, NOW).toISOString()).toBe(
      '2027-01-14T10:00:00.000Z',
    );
  });
});
