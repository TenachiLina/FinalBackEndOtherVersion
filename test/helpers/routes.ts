import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import {
  FEATURE_KEY,
  IS_PUBLIC_KEY,
  KIOSK_KEY,
  NO_COMPANY_KEY,
  ROLES_KEY,
  type Role,
} from '../../src/auth/auth.decorators';
import type { Feature } from '../../src/companies/company.schema';

export interface RouteInfo {
  method: string;
  path: string;
  /** "GET /employees/:id" */
  key: string;
  isPublic: boolean;
  roles: Role[];
  feature?: Feature;
  kiosk: boolean;
  noCompany: boolean;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });
}

/**
 * Every route of every controller registered in AppModule, with the access
 * rules its decorators declare (method decorators override class ones, as in
 * the auth guard).
 */
export function allRoutes(registered: Set<unknown>): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const file of controllerFiles(join(__dirname, '../../src'))) {
    for (const ctrl of Object.values(require(file) as Record<string, any>)) {
      if (typeof ctrl !== 'function' || !registered.has(ctrl)) continue;
      const base = Reflect.getMetadata(PATH_METADATA, ctrl);
      if (base === undefined) continue;
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        const handler = ctrl.prototype[name];
        const verb = Reflect.getMetadata(METHOD_METADATA, handler);
        if (verb === undefined) continue;
        const meta = <T>(key: string): T | undefined =>
          Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, ctrl);
        const sub = Reflect.getMetadata(PATH_METADATA, handler);
        const path = `/${[base, sub]
          .flat()
          .filter((p) => p && p !== '/')
          .join('/')}`;
        const method = RequestMethod[verb];
        routes.push({
          method,
          path,
          key: `${method} ${path}`,
          isPublic: !!meta<boolean>(IS_PUBLIC_KEY),
          roles: meta<Role[]>(ROLES_KEY) ?? [],
          feature: meta<Feature>(FEATURE_KEY),
          kiosk: !!meta<boolean>(KIOSK_KEY),
          noCompany: !!meta<boolean>(NO_COMPANY_KEY),
        });
      }
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

/** Controllers of AppModule and every module it imports (no app needed). */
export function registeredControllers(): Set<unknown> {
  const { AppModule } = require('../../src/app.module');
  const found = new Set<unknown>();
  const seen = new Set<unknown>();
  const visit = (mod: any) => {
    const cls = mod?.module ?? mod; // dynamic modules: { module, ... }
    if (!cls || seen.has(cls)) return;
    seen.add(cls);
    const meta = (key: string) => [
      ...(Reflect.getMetadata(key, cls) ?? []),
      ...(mod?.module ? (mod[key] ?? []) : []),
    ];
    for (const c of meta(MODULE_METADATA.CONTROLLERS)) found.add(c);
    for (const m of meta(MODULE_METADATA.IMPORTS)) visit(m);
  };
  visit(AppModule);
  return found;
}
