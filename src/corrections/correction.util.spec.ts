import { BadRequestException } from '@nestjs/common';
import {
  FEATURE_OF,
  MESSAGE_MAX,
  parseDay,
  parseDecision,
  parseKind,
  parseMessage,
  parseReply,
  parseStatusFilter,
} from './correction.util';

describe('correction checks', () => {
  it('accepts the three kinds, each tied to its feature', () => {
    expect(parseKind('worktime')).toBe('worktime');
    expect(parseKind('advance')).toBe('advance');
    expect(parseKind('bonus')).toBe('bonus');
    expect(FEATURE_OF).toEqual({
      worktime: 'clockin',
      advance: 'advances',
      bonus: 'bonuses',
    });
    for (const bad of [undefined, '', 'salary', 1]) {
      expect(() => parseKind(bad)).toThrow(BadRequestException);
    }
  });

  it('trims the message and bounds its length', () => {
    expect(parseMessage('  My hours are wrong  ')).toBe('My hours are wrong');
    expect(() => parseMessage('ok')).toThrow(
      'Describe the mistake in a few words',
    );
    expect(() => parseMessage(undefined)).toThrow(BadRequestException);
    expect(() => parseMessage(42)).toThrow(BadRequestException);
    expect(parseMessage('x'.repeat(MESSAGE_MAX))).toHaveLength(MESSAGE_MAX);
    expect(() => parseMessage('x'.repeat(MESSAGE_MAX + 1))).toThrow(
      'The message can be at most 500 characters',
    );
  });

  it('only accepts real days', () => {
    expect(parseDay('2026-11-14')).toBe('2026-11-14');
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '14/11/2026',
      '',
      undefined,
      20261114,
    ]) {
      expect(() => parseDay(bad)).toThrow('date must be YYYY-MM-DD');
    }
  });

  it('reads the manager decision and reply', () => {
    expect(parseDecision('corrected')).toBe('corrected');
    expect(parseDecision('rejected')).toBe('rejected');
    expect(() => parseDecision('pending')).toThrow(
      'Choose Corrected or Rejected',
    );
    expect(() => parseDecision(undefined)).toThrow(BadRequestException);
    expect(parseReply(undefined)).toBeNull();
    expect(parseReply(null)).toBeNull();
    expect(parseReply('   ')).toBeNull();
    expect(parseReply(' Fixed, thanks ')).toBe('Fixed, thanks');
    expect(() => parseReply('x'.repeat(MESSAGE_MAX + 1))).toThrow(
      'The reply can be at most 500 characters',
    );
  });

  it('filters the manager list by status', () => {
    expect(parseStatusFilter(undefined)).toBeNull();
    expect(parseStatusFilter('')).toBeNull();
    expect(parseStatusFilter('all')).toBeNull();
    expect(parseStatusFilter('pending')).toBe('pending');
    expect(parseStatusFilter('rejected')).toBe('rejected');
    expect(() => parseStatusFilter('open')).toThrow(BadRequestException);
  });
});
