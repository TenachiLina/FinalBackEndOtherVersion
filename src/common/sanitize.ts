const SECRET_KEY = /password|token|secret/i;
const MAX_STRING = 200;
const MAX_ARRAY = 10;
const MAX_DEPTH = 4;

/**
 * A copy of request data that is safe and small enough to store in a log:
 * no passwords or tokens, images replaced, long text and lists shortened.
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return '[image]';
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…`
      : value;
  }
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return `[${value.length} items]`;
    return value.map((v) => sanitize(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = sanitize(v, depth + 1);
  }
  return out;
}
