# Test findings: employees, shifts and tasks

Bugs found while testing `src/employees/*`, `src/shifts/*` and `src/tasks/*`.
Each bug has a test marked `it.failing(...)` with a `// BUG-2NN` comment above it. The test describes the
**correct** behaviour and currently fails. Entry format: see [../TEST_FINDINGS.md](../TEST_FINDINGS.md).

## Open issues

Sorted by severity.

### BUG-203: A manager can raise their own salary
- **Severity:** Medium
- **Type:** Security (permissions)
- **Location:** `src/employees/employees.controller.ts`, `update` / `assertCanChange` (only *other* managers are protected)
- **Found by:** `staff.e2e-spec.ts` › "employees › as a manager › can't change their own salary"
- **Steps / input:** A manager whose account is linked to their employee record sends `PUT /employees/<own id>` with `{ "baseSalary": 99000 }`.
- **Expected:** 403. A manager can't see other managers' salaries, so changing their own should be for an admin only.
- **Actual:** Saved. Payroll then pays the new salary. The same manager can also delete their own employee record.
- **Suggested fix:** In `assertCanChange`, also refuse the manager's own linked employee (`user.employeeId`), at least for `baseSalary`; or let managers change salaries only for employees who aren't managers.
- **Status:** Open

### BUG-204: A shift still used in the planning is deleted at once
- **Severity:** Medium
- **Type:** Bug (data loss)
- **Location:** `src/shifts/shifts.service.ts`, `remove(id, force)` (`force` is never used)
- **Found by:** `staff.e2e-spec.ts` › "shifts › asks before deleting a shift that is still in the planning, then deletes with force"
- **Steps / input:** Plan someone on the 08:00–16:00 shift, then delete that shift from Shifts management.
- **Expected:** 409 with `{ usageCount: 1 }`, as the frontend expects (its BUG-403 fix reads `usageCount` and asks "This shift is used N times, delete anyway?"); then `DELETE /shifts/:id?force=true` deletes it.
- **Actual:** The shift is deleted straight away. The confirmation is never shown, and the planning entries keep a `shiftId` that points at nothing (they show as an unknown shift and drop out of the exports).
- **Suggested fix:** Count planning entries with this `shiftId`; if any and `force` is false, throw `ConflictException({ message, usageCount })`. On force, decide what happens to those entries (delete them, or archive the shift instead).
- **Status:** Open

### BUG-201: An edit can empty an employee's name
- **Severity:** Low
- **Type:** Bug (validation)
- **Location:** `src/employees/employees.service.ts`, `update` (`findByIdAndUpdate` without `runValidators`); same in shifts and tasks
- **Found by:** `staff.e2e-spec.ts` › "refuses an edit that empties the employee's name"
- **Steps / input:** `PUT /employees/:id` with `{ "firstName": "" }`.
- **Expected:** 400 "First name is required", as when adding an employee.
- **Actual:** Saved with an empty first name. Required fields and types are only checked when a record is created.
- **Suggested fix:** Pass `{ new: true, runValidators: true }` to `findByIdAndUpdate` in the employees, shifts and tasks services (worktime already does).
- **Status:** Open

### BUG-202: An unknown id answers 200 with an empty body instead of 404
- **Severity:** Low
- **Type:** Bug
- **Location:** `findOne` / `update` / `remove` in `src/employees/employees.service.ts`, `src/shifts/shifts.service.ts` (`findOne`, `update`), `src/tasks/tasks.service.ts`
- **Found by:** `staff.e2e-spec.ts` › "get/put/delete /employees/:id with an unknown id → 404" (8 cases)
- **Steps / input:** `GET`, `PUT` or `DELETE /employees/<id that doesn't exist>` (or an employee that another tab just deleted); same for tasks, and `GET`/`PUT` for shifts.
- **Expected:** 404 "… not found", as shifts already do for archive/restore/delete, and advances and bonuses.
- **Actual:** 200 with an empty body. The frontend reports a save as successful when nothing was saved.
- **Suggested fix:** Throw `NotFoundException` when the query returns `null`.
- **Status:** Open

### BUG-205: The API accepts an employee without an employee number
- **Severity:** Low
- **Type:** Bug (validation)
- **Location:** `src/employees/employee.shema.ts` (`empNumber` is optional, but unique per company)
- **Found by:** `staff.e2e-spec.ts` › "requires an employee number above 0, as the app does"
- **Steps / input:** `POST /employees` without `empNumber`, or with 0 or a negative number.
- **Expected:** 400. The app requires a whole number above 0, and advances, bonuses and work time find employees by that number.
- **Actual:** Saved. A second employee without a number is then refused with 409 "This employee number is already used", because the unique index counts "no number" as a value.
- **Suggested fix:** `@Prop({ required: true, min: 1 }) empNumber`.
- **Status:** Open

## Observations (not bugs, to confirm)

## Fixed issues
