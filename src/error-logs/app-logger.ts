import { ConsoleLogger } from '@nestjs/common';
import { reportError, UNREPORTED_CONTEXTS } from './error-reporter';

const looksLikeStack = (s: unknown) =>
  typeof s === 'string' && /\n\s*at /.test(s);

/**
 * Nest's normal console logger, but every logger.error(...) in the backend is
 * also saved to the system error log, so failures in background work (device
 * sync, worktime saving…) are recorded and not only printed.
 */
export class AppLogger extends ConsoleLogger {
  error(message: any, ...params: any[]) {
    super.error(message, ...params);

    // Nest passes (message, stack?, context?); either may be missing.
    let stack: string | undefined;
    let context: string | undefined;
    if (params.length >= 2) {
      stack = params[0];
      context = params[params.length - 1];
    } else if (looksLikeStack(params[0])) {
      stack = params[0];
    } else {
      context = params[0];
    }
    context = typeof context === 'string' ? context : this.context;
    if (context && UNREPORTED_CONTEXTS.has(context)) return;

    const error = message instanceof Error ? message : null;
    reportError(error, {
      level: 'error',
      source: 'background',
      context,
      name: error ? undefined : context ? `${context} error` : 'Error',
      message: error ? undefined : String(message),
      stack: error ? undefined : typeof stack === 'string' ? stack : undefined,
    });
  }
}
