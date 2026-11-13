import { BadRequestException } from '@nestjs/common';
import type { Feature } from '../companies/company.schema';
import {
  CORRECTION_KINDS,
  CORRECTION_STATUSES,
  type CorrectionKind,
  type CorrectionStatus,
} from './correction.schema';

export const MESSAGE_MIN = 3;
export const MESSAGE_MAX = 500;
/** Reports an employee may have waiting at once. */
export const MAX_PENDING = 20;

/** The company feature each kind of report needs. */
export const FEATURE_OF: Record<CorrectionKind, Feature> = {
  worktime: 'clockin',
  advance: 'advances',
  bonus: 'bonuses',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseKind(kind: unknown): CorrectionKind {
  if (!CORRECTION_KINDS.includes(kind as CorrectionKind)) {
    throw new BadRequestException(
      'Choose what the mistake is about: worked time, an advance or a bonus',
    );
  }
  return kind as CorrectionKind;
}

export function parseMessage(message: unknown): string {
  const text = typeof message === 'string' ? message.trim() : '';
  if (text.length < MESSAGE_MIN) {
    throw new BadRequestException('Describe the mistake in a few words');
  }
  if (text.length > MESSAGE_MAX) {
    // MESSAGE_MAX: written out so the message gets its translations
    throw new BadRequestException('The message can be at most 500 characters');
  }
  return text;
}

/** A real calendar day "YYYY-MM-DD". */
export function parseDay(day: unknown): string {
  const s = typeof day === 'string' ? day : '';
  const d = new Date(`${s}T00:00:00.000Z`);
  if (
    !ISO_DAY.test(s) ||
    Number.isNaN(d.getTime()) ||
    d.toISOString().slice(0, 10) !== s
  ) {
    throw new BadRequestException('date must be YYYY-MM-DD');
  }
  return s;
}

/** The decision a manager makes on a report. */
export function parseDecision(
  status: unknown,
): Exclude<CorrectionStatus, 'pending'> {
  if (status !== 'corrected' && status !== 'rejected') {
    throw new BadRequestException('Choose Corrected or Rejected');
  }
  return status;
}

export function parseReply(reply: unknown): string | null {
  if (reply == null) return null;
  const text = String(reply).trim();
  if (text.length > MESSAGE_MAX) {
    throw new BadRequestException('The reply can be at most 500 characters');
  }
  return text || null;
}

/** ?status= on the manager list: one status, or every one. */
export function parseStatusFilter(status: unknown): CorrectionStatus | null {
  if (status == null || status === '' || status === 'all') return null;
  if (!CORRECTION_STATUSES.includes(status as CorrectionStatus)) {
    throw new BadRequestException(
      'status must be pending, corrected, rejected or all',
    );
  }
  return status as CorrectionStatus;
}
