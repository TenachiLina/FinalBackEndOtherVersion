import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'skipAudit';

// Requests on this route or controller are not written to the activity log
// (e.g. the clocking machine, which is not a user).
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

/**
 * "METHOD /route/:pattern" → action key shown in the activity log.
 * Only changes are logged (POST, PUT, PATCH, DELETE); reads are not.
 * A route missing here is still logged, as "other".
 */
const ACTIONS: Record<string, string> = {
  'POST /auth/login': 'auth.login',
  'POST /auth/change-password': 'auth.changePassword',
  'POST /auth/logout': 'auth.logout',
  'POST /auth/logout-others': 'auth.logoutOthers',
  'DELETE /auth/sessions/:id': 'session.revoke',
  'DELETE /login-sessions/:id': 'session.revokeByAdmin',

  'POST /users': 'user.create',
  'PATCH /users/:id': 'user.update',
  'POST /users/:id/password': 'user.resetPassword',
  'DELETE /users/:id': 'user.delete',

  'POST /companies': 'company.create',
  'PATCH /companies/:id': 'company.update',
  'PATCH /company': 'companySettings.update',

  'POST /employees': 'employee.create',
  'PUT /employees/:id': 'employee.update',
  'DELETE /employees/:id': 'employee.delete',

  'POST /shifts': 'shift.create',
  'PUT /shifts/:id': 'shift.update',
  'PATCH /shifts/:id/archive': 'shift.archive',
  'PATCH /shifts/:id/restore': 'shift.restore',
  'DELETE /shifts/:id': 'shift.delete',

  'POST /tasks': 'task.create',
  'PUT /tasks/:id': 'task.update',
  'DELETE /tasks/:id': 'task.delete',

  'POST /planning': 'planning.create',
  'POST /planning/bulk': 'planning.saveDay',
  'POST /planning/copy-month': 'planning.copyMonth',
  'PUT /planning/:id': 'planning.update',
  'DELETE /planning/:id': 'planning.delete',

  'POST /worktime': 'worktime.create',
  'PUT /worktime/:id': 'worktime.update',
  'DELETE /worktime/:id': 'worktime.delete',

  'POST /attendance/sync': 'attendance.sync',
  'POST /attendance/device-logs': 'punch.create',
  'PATCH /attendance/device-logs/:id': 'punch.update',
  'DELETE /attendance/device-logs/:id': 'punch.delete',

  'POST /advances': 'advance.create',
  'DELETE /advances/:id': 'advance.delete',

  'POST /bonuses': 'bonus.create',
  'DELETE /bonuses/:id': 'bonus.delete',
};

export function actionFor(method: string, route: string, body: any): string {
  // The kiosk has one route for both directions.
  if (method === 'POST' && route === '/kiosk/clock') {
    return body?.action === 'out' ? 'kiosk.clockOut' : 'kiosk.clockIn';
  }
  return ACTIONS[`${method} ${route}`] ?? 'other';
}

/**
 * A readable name for the record an action was about, taken from what was
 * sent or what came back (deletes return the deleted record).
 */
export function describeTarget(body: any, result: any): string | undefined {
  for (const src of [result?.employee, result?.data, result, body]) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    const fullName = [src.firstName, src.lastName].filter(Boolean).join(' ');
    if (fullName) return fullName;
    for (const key of ['name', 'taskName', 'label', 'email']) {
      if (typeof src[key] === 'string' && src[key]) return src[key];
    }
    const emp = src.empNumber ?? src.emp_id ?? src.empId ?? src.deviceUserId;
    if (emp !== undefined && emp !== null && emp !== '') {
      return `Employee #${emp}`;
    }
  }
  if (body?.planDate) return String(body.planDate).slice(0, 10);
  if (body?.sourceMonth && body?.destinationMonth) {
    return `${body.sourceMonth} → ${body.destinationMonth}`;
  }
  return undefined;
}
