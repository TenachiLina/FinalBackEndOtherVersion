import { createHash, randomBytes } from 'node:crypto';
import { currentCompanyId } from '../tenancy/tenant-context';

/**
 * Collects errors from anywhere in the backend (the exception filter, the
 * logger, process crashes) and hands them to ErrorLogService, which saves
 * them. Plain functions instead of a Nest provider, so code that runs before
 * or outside Nest's dependency injection can report too.
 */

export type ErrorLevel = 'error' | 'warning';
// request: an API call failed · background: logged by code (e.g. a sync job)
// process: an unhandled crash · frontend: a page crashed in someone's browser
export type ErrorSource = 'request' | 'background' | 'process' | 'frontend';

export interface ErrorReport {
  reference?: string;
  level: ErrorLevel;
  source: ErrorSource;
  name: string;
  message: string;
  code?: string;
  // Plain-language guess at the cause, and the line of our code it came from
  hint?: string;
  where?: string;
  stack?: string;
  // The logger context (usually the class name) for background errors
  context?: string;
  // Same fingerprint = same error, so repeats can be counted together
  fingerprint: string;

  statusCode?: number;
  method?: string;
  path?: string;
  route?: string;
  query?: unknown;
  body?: unknown;
  pageUrl?: string;
  userAgent?: string;
  ip?: string;

  companyId?: string | null;
  userId?: string | null;
  userName?: string;
  userEmail?: string;
  userRole?: string;
}

// Logger contexts whose errors are already reported directly, or that come
// from saving errors itself (reporting those would loop).
export const UNREPORTED_CONTEXTS = new Set([
  'Errors',
  'Process',
  'ErrorLogService',
]);

const MAX_PENDING = 100;
const MAX_STACK = 6000;
const MAX_MESSAGE = 2000;

type Writer = (report: ErrorReport) => Promise<void>;
let writer: Writer | null = null;
// Errors raised before the database is ready are kept until it is.
const pending: ErrorReport[] = [];

export function setErrorWriter(w: Writer) {
  writer = w;
  for (const report of pending.splice(0)) void w(report);
}

/** Short code shown to the user with a server error, to find it in the log. */
export function newReference(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

export function reportError(
  error: unknown,
  extra: Partial<ErrorReport> & Pick<ErrorReport, 'level' | 'source'>,
) {
  const e = (error ?? {}) as any;
  const isObject = typeof error === 'object' && error !== null;
  const name = String(
    extra.name ?? (isObject ? (e.name ?? e.constructor?.name) : null) ?? 'Error',
  );
  const message = String(
    extra.message ?? (isObject ? e.message : error) ?? 'Unknown error',
  ).slice(0, MAX_MESSAGE);
  const stack = (extra.stack ?? (isObject ? e.stack : undefined))?.slice(
    0,
    MAX_STACK,
  );
  const code = extra.code ?? (e.code !== undefined ? String(e.code) : undefined);
  const where = extra.where ?? locate(stack);

  const report: ErrorReport = {
    companyId: currentCompanyId(),
    ...extra,
    name,
    message,
    code,
    stack,
    where,
    hint:
      extra.hint ??
      explain(name, message, code, extra.statusCode, isObject ? e : {}),
    fingerprint: fingerprint(name, message, extra.route ?? where),
  };

  if (writer) void writer(report);
  else if (pending.length < MAX_PENDING) pending.push(report);
}

/**
 * The first line of the stack trace that is our own code, e.g.
 * "planning/planning.service.ts:212 (PlanningService.findAll)".
 */
export function locate(stack?: string): string | undefined {
  if (!stack) return undefined;
  for (const line of stack.split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/.exec(line);
    if (!m) continue;
    const [, fn, file, lineNo] = m;
    if (/node_modules|^node:|internal\//.test(file)) continue;
    const short = file
      .replace(/\\/g, '/')
      .replace(/^.*?\/(src|dist|_next\/static\/chunks|webpack-internal:\/\/\/)\//, '');
    return `${short}:${lineNo}${fn ? ` (${fn})` : ''}`;
  }
  return undefined;
}

function fingerprint(name: string, message: string, where?: string) {
  const normalized = message
    .replace(/[0-9a-f]{24}/gi, '<id>')
    .replace(/"[^"]*"|'[^']*'/g, '<value>')
    .replace(/\d+/g, '<n>');
  return createHash('sha1')
    .update(`${name}|${normalized}|${where ?? ''}`)
    .digest('hex')
    .slice(0, 12);
}

/** A plain-language explanation of the most common causes. */
function explain(
  name: string,
  message: string,
  code: string | undefined,
  status: number | undefined,
  e: any,
): string | undefined {
  const text = `${name} ${message} ${code ?? ''}`;

  if (
    /MongoServerSelection|MongoNetwork|MongoNotConnected|buffering timed out|ECONNREFUSED.*27017/i.test(
      text,
    )
  ) {
    return "The server couldn't reach the database. Check that MONGODB_URI is correct, the database is running and, on MongoDB Atlas, that this server's IP address is allowed under Network Access.";
  }
  if (name === 'CastError') {
    return `A value had the wrong type for "${e.path ?? 'a field'}". Usually a broken or old link with an invalid record ID, or text sent where a number was expected.`;
  }
  if (name === 'ValidationError') {
    return "The data sent was missing required fields or had values the database doesn't accept. The message lists the fields.";
  }
  if (code === '11000') {
    return 'A record with the same unique value already exists (for example an email, employee number or device serial).';
  }
  if (name === 'TenantContextError') {
    return "Data was accessed without a company selected. Usually a super admin who hasn't picked a company, or background code that should run inside runForCompany().";
  }
  if (/JsonWebTokenError|TokenExpiredError/.test(name)) {
    return 'The sign-in token was invalid or expired. If this happens to everyone at once, JWT_SECRET probably changed.';
  }
  if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|ECONNRESET/.test(text)) {
    return "Couldn't connect to another machine or service (its address is in the message). It may be switched off, unreachable from this server, or the address or port is wrong.";
  }
  const missing = /Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '([^']+)'\))?/.exec(
    message,
  );
  if (missing) {
    return `A bug: the code tried to use ${missing[2] ? `"${missing[2]}"` : 'a property'} on a value that was ${missing[1]}. The "Where" line shows the code. Often caused by a deleted record or a field that is optional.`;
  }
  if (name === 'TypeError' && /is not a function/.test(message)) {
    return "A bug: the code called something that isn't a function. Often a typo or a value of an unexpected type. See the \"Where\" line.";
  }
  if (name === 'ReferenceError') {
    return 'A bug: the code uses a name that does not exist. See the "Where" line.';
  }
  if (name === 'ChunkLoadError' || /Loading chunk .* failed/i.test(message)) {
    return "The browser couldn't load part of the app, usually right after a new version was deployed. Reloading the page fixes it.";
  }
  if (/Hydration|did not match/i.test(message)) {
    return 'The page looked different in the browser than on the server, often because of dates, times or data saved in the browser.';
  }
  if (name === 'SyntaxError' && /JSON/.test(message)) {
    return "Some text that should be JSON couldn't be read (a request body, device data or a server answer).";
  }
  if (status && status >= 400 && status < 500) {
    return `Refused on purpose by a check in the app (status ${status}). The message says why; this is usually a user mistake or missing permission, not a bug.`;
  }
  return undefined;
}
