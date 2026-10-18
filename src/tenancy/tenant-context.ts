import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which company the current request works for.
 *
 * Every HTTP request gets its own store (see tenantContextMiddleware). The auth
 * guard fills in companyId for logged-in users, and the ZKTeco controller fills
 * it in from the device serial. The tenant plugin reads it on every query.
 */
interface TenantStore {
  companyId: string | null;
  // Set only by trusted code (scripts, company admin tasks) that must see every company.
  system: boolean;
}

const storage = new AsyncLocalStorage<TenantStore>();

export function tenantContextMiddleware(
  _req: unknown,
  _res: unknown,
  next: () => void,
) {
  storage.run({ companyId: null, system: false }, next);
}

export function setCurrentCompany(companyId: string | null) {
  const store = storage.getStore();
  if (!store)
    throw new Error(
      'No tenant context: is tenantContextMiddleware registered?',
    );
  store.companyId = companyId;
}

export function currentCompanyId(): string | null {
  return storage.getStore()?.companyId ?? null;
}

export function isSystemContext(): boolean {
  return storage.getStore()?.system ?? false;
}

/** Runs fn with data access scoped to one company (used outside HTTP requests). */
export function runForCompany<T>(companyId: string, fn: () => T): T {
  return storage.run({ companyId, system: false }, fn);
}

/** Runs fn without company filtering. Only for trusted, cross-company code. */
export function runAsSystem<T>(fn: () => T): T {
  return storage.run({ companyId: null, system: true }, fn);
}
