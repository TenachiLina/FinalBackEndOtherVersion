import { BadRequestException } from '@nestjs/common';
import { capitalize, label } from './field-labels';

// ─────────────────────────────────────────────────────────────────────────
// Request validation
//
// A request body is checked against a list of the fields it may contain
// before it reaches a service or the database:
//   - a field that is not listed is dropped (nothing unexpected is saved)
//   - a listed field with the wrong kind of value is refused (400)
//   - on creation, a required field must be there
// The messages are the ones the app already uses and translates:
//   "First name is required", "Base salary is too small",
//   "Start time has an invalid value", "Family status has a value that
//   isn't allowed".
//
//   const data = validateBody(body, EMPLOYEE_FIELDS);            // create
//   const data = validateBody(body, EMPLOYEE_FIELDS, 'partial'); // update
// ─────────────────────────────────────────────────────────────────────────

export type Kind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  /** "HH:MM" or "HH:MM:SS" */
  | 'time'
  /** "YYYY-MM-DD" */
  | 'day'
  /** A date: "YYYY-MM-DD", an ISO date-time or a timestamp */
  | 'date'
  /** A list of strings */
  | 'strings'
  /** A list of plain objects */
  | 'objects';

export interface Rule {
  kind: Kind;
  /** Must be there when the record is created */
  required?: boolean;
  /** Smallest number, or shortest text */
  min?: number;
  /** Largest number, longest text or longest list */
  max?: number;
  /** The only values allowed */
  oneOf?: readonly (string | number)[];
  /** null is a value (it clears the field) */
  nullable?: boolean;
  /** An empty text is a value (it clears the field); otherwise "" counts as missing */
  allowEmpty?: boolean;
}

export type Rules = Record<string, Rule>;

const TIME = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isRealDay = (value: string) =>
  DAY.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

type Problem = 'invalid' | 'small' | 'large' | 'notAllowed';

/** The value as it will be saved, or what is wrong with it. */
function check(value: unknown, rule: Rule): { value: unknown } | Problem {
  switch (rule.kind) {
    case 'string': {
      if (typeof value !== 'string') return 'invalid';
      const text = value.trim();
      if (rule.oneOf && !rule.oneOf.includes(text)) return 'notAllowed';
      if (rule.min !== undefined && text.length < rule.min) return 'small';
      if (rule.max !== undefined && text.length > rule.max) return 'large';
      return { value: text };
    }
    case 'number':
    case 'integer': {
      // Forms send numbers as text: "45000" is a number, "abc" and "" are not
      const n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : NaN;
      if (!Number.isFinite(n)) return 'invalid';
      if (rule.kind === 'integer' && !Number.isInteger(n)) return 'invalid';
      if (rule.oneOf && !rule.oneOf.includes(n)) return 'notAllowed';
      if (rule.min !== undefined && n < rule.min) return 'small';
      if (rule.max !== undefined && n > rule.max) return 'large';
      return { value: n };
    }
    case 'boolean':
      if (typeof value === 'boolean') return { value };
      if (value === 'true' || value === 1) return { value: true };
      if (value === 'false' || value === 0) return { value: false };
      return 'invalid';
    case 'time':
      return typeof value === 'string' && TIME.test(value.trim())
        ? { value: value.trim() }
        : 'invalid';
    case 'day':
      return typeof value === 'string' && isRealDay(value.trim())
        ? { value: value.trim() }
        : 'invalid';
    case 'date': {
      if (typeof value === 'string' && DAY.test(value.trim())) {
        return isRealDay(value.trim()) ? { value: value.trim() } : 'invalid';
      }
      const ok =
        (typeof value === 'string' && value.trim() !== '') ||
        typeof value === 'number' ||
        value instanceof Date;
      if (!ok || Number.isNaN(new Date(value as string).getTime())) {
        return 'invalid';
      }
      return { value };
    }
    case 'strings': {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        return 'invalid';
      }
      if (rule.max !== undefined && value.length > rule.max) return 'large';
      return { value };
    }
    case 'objects': {
      if (!Array.isArray(value) || value.some((v) => !isPlainObject(v))) {
        return 'invalid';
      }
      if (rule.max !== undefined && value.length > rule.max) return 'large';
      return { value };
    }
  }
}

const MESSAGES: Record<Problem, string> = {
  invalid: 'has an invalid value',
  small: 'is too small',
  large: 'is too large',
  notAllowed: "has a value that isn't allowed",
};

/**
 * Checks a request body and returns only the listed fields, cleaned (texts
 * trimmed, numbers as numbers). Throws 400 with one message per wrong field.
 * 'partial' is for updates: nothing is required, only what is sent is checked.
 */
export function validateBody<T = Record<string, unknown>>(
  body: unknown,
  rules: Rules,
  mode: 'full' | 'partial' = 'full',
): T {
  if (!isPlainObject(body)) {
    throw new BadRequestException('The data sent was not valid');
  }
  const clean: Record<string, unknown> = {};
  const problems: string[] = [];

  for (const [field, rule] of Object.entries(rules)) {
    const name = capitalize(label(field));
    const value = body[field];
    const empty =
      value === undefined ||
      (value === null && !rule.nullable) ||
      (typeof value === 'string' && value.trim() === '' && !rule.allowEmpty);

    if (empty) {
      // Sending a required field empty is refused, also in an update
      const sent = value !== undefined;
      if (rule.required && (mode === 'full' || sent)) {
        problems.push(`${name} is required`);
      }
      continue;
    }
    if (value === null) {
      clean[field] = null;
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') {
      clean[field] = '';
      continue;
    }
    const result = check(value, rule);
    if (typeof result === 'string') problems.push(`${name} ${MESSAGES[result]}`);
    else clean[field] = result.value;
  }

  if (problems.length) throw new BadRequestException(problems);
  return clean as T;
}
