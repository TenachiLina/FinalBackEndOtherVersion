import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { actionFor, describeTarget, SKIP_AUDIT_KEY } from './audit-actions';
import { IS_PUBLIC_KEY } from '../auth/auth.decorators';

describe('actionFor', () => {
  it('names known changes', () => {
    expect(actionFor('POST', '/employees', {})).toBe('employee.create');
    expect(actionFor('DELETE', '/shifts/:id', {})).toBe('shift.delete');
    expect(actionFor('POST', '/planning/bulk', {})).toBe('planning.saveDay');
  });

  it('tells clock-in from clock-out on the kiosk', () => {
    expect(actionFor('POST', '/kiosk/clock', { action: 'in' })).toBe(
      'kiosk.clockIn',
    );
    expect(actionFor('POST', '/kiosk/clock', { action: 'out' })).toBe(
      'kiosk.clockOut',
    );
    expect(actionFor('POST', '/kiosk/clock', undefined)).toBe('kiosk.clockIn');
  });

  it('logs anything else as "other"', () => {
    expect(actionFor('PATCH', '/nothing', {})).toBe('other');
  });
});

// Every route that changes data should have a name in the activity log,
// otherwise it shows up as "other".
function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });
}

function loggedRoutes(): string[] {
  const routes: string[] = [];
  for (const file of controllerFiles(join(__dirname, '..'))) {
    for (const exported of Object.values(
      require(file) as Record<string, unknown>,
    )) {
      if (typeof exported !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, exported);
      if (base === undefined) continue;
      const classSkips =
        Reflect.getMetadata(SKIP_AUDIT_KEY, exported) ||
        Reflect.getMetadata(IS_PUBLIC_KEY, exported);
      for (const key of Object.getOwnPropertyNames(exported.prototype)) {
        const handler = exported.prototype[key];
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;
        const verb = RequestMethod[method];
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        const route = `/${[base, path]
          .flat()
          .filter((p) => p && p !== '/')
          .join('/')}`.replace(/\/+/g, '/');
        const skipped =
          classSkips ||
          Reflect.getMetadata(SKIP_AUDIT_KEY, handler) ||
          (Reflect.getMetadata(IS_PUBLIC_KEY, handler) &&
            route !== '/auth/login');
        if (!skipped) routes.push(`${verb} ${route}`);
      }
    }
  }
  return routes.sort();
}

describe('routes that change data', () => {
  const routes = loggedRoutes();

  it('are found', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('all have a name in the activity log', () => {
    const unnamed = routes.filter((r) => {
      const [verb, route] = r.split(' ');
      return actionFor(verb, route, {}) === 'other';
    });
    expect(unnamed).toEqual([]);
  });
});

describe('describeTarget', () => {
  it('prefers what came back, then what was sent', () => {
    expect(
      describeTarget(
        { firstName: 'Sent' },
        { firstName: 'Ali', lastName: 'Ben' },
      ),
    ).toBe('Ali Ben');
    expect(describeTarget({ firstName: 'Sent' }, null)).toBe('Sent');
    expect(describeTarget({}, { employee: { firstName: 'Sara' } })).toBe(
      'Sara',
    );
    expect(describeTarget({}, { data: { name: 'Pizza' } })).toBe('Pizza');
  });

  it('uses names, labels and emails', () => {
    expect(describeTarget({ taskName: 'Cashier' }, undefined)).toBe('Cashier');
    expect(describeTarget({ label: 'Morning' }, undefined)).toBe('Morning');
    expect(describeTarget({ email: 'a@b.dz' }, undefined)).toBe('a@b.dz');
  });

  it('falls back to the employee number', () => {
    expect(describeTarget({ emp_id: 12 }, undefined)).toBe('Employee #12');
    expect(describeTarget({ deviceUserId: '7' }, undefined)).toBe(
      'Employee #7',
    );
    expect(describeTarget({ empNumber: 0 }, undefined)).toBe('Employee #0');
  });

  it('names a planning day or a copied month', () => {
    expect(describeTarget({ planDate: '2026-10-20T00:00:00.000Z' }, [])).toBe(
      '2026-10-20',
    );
    expect(
      describeTarget(
        { sourceMonth: '2026-09', destinationMonth: '2026-10' },
        undefined,
      ),
    ).toBe('2026-09 → 2026-10');
  });

  it('gives up on lists and empty data', () => {
    expect(describeTarget([{ name: 'x' }], [{ name: 'y' }])).toBeUndefined();
    expect(describeTarget(undefined, undefined)).toBeUndefined();
    expect(describeTarget({ emp_id: '' }, undefined)).toBeUndefined();
  });
});
