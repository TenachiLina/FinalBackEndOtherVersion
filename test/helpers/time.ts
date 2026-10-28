/**
 * Runs fn with process.env.TZ set (Node applies it immediately), then
 * restores it. Use it to run date code as a server in Algeria would:
 *   await withTimeZone('Africa/Algiers', async () => { ... });
 */
export async function withTimeZone<T>(
  tz: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await fn();
  } finally {
    process.env.TZ = before;
  }
}

/**
 * Fixes "now" without freezing setTimeout/setImmediate, which Nest,
 * Mongoose and supertest need. Undo with jest.useRealTimers().
 */
export function setNow(when: string | number) {
  // Read before faking: the fake Date is not accepted by setSystemTime
  const ms = typeof when === 'number' ? when : Date.parse(when);
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'setImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
    ],
  });
  jest.setSystemTime(ms);
}
