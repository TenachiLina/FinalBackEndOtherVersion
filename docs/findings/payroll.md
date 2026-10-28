# Test findings: worktime, advances and bonuses

Bugs found while testing `src/worktime/*`, `src/advances/*` and `src/bonuses/*`.
Each bug has a test marked `it.failing(...)` with a `// BUG-4NN` comment above it. The test describes the
**correct** behaviour and currently fails. Entry format: see [../TEST_FINDINGS.md](../TEST_FINDINGS.md).

## Open issues

Sorted by severity.

### BUG-401: An advance of 0 or a negative amount is accepted
- **Severity:** Medium
- **Type:** Bug (money)
- **Location:** `src/advances/advances.service.ts`, `create` (no check on `amount`)
- **Found by:** `payroll.e2e-spec.ts` › "refuses an advance of 0" / "refuses an advance of -5000"
- **Steps / input:** `POST /advances` with `{ emp_id: 4, amount: -5000, date: "2026-10-05" }`.
- **Expected:** 400, as bonuses do ("amount must be greater than 0").
- **Actual:** Saved. A negative advance *adds* money to the payslip; a 0 advance blocks the real one for that date ("already exists"). The frontend fixed its side (its BUG-503), but any other client or an old tab can still send it.
- **Suggested fix:** Same check as bonuses: `Number.isFinite(amount) && amount > 0`, and refuse a date that isn't `YYYY-MM-DD`.
- **Status:** Open

### BUG-403: Two work time records can be saved for the same employee, shift and day
- **Severity:** Medium
- **Type:** Bug (money)
- **Location:** `src/worktime/worktime.service.ts` `create`; no unique index in `src/worktime/worktime.shema.ts`
- **Found by:** `payroll.e2e-spec.ts` › "keeps one record per employee, shift and day"
- **Steps / input:** Two saves for the same employee, shift and day arrive together (two tabs, the kiosk and a manager, or a double click): two `POST /worktime`.
- **Expected:** One record (the second save updates it, or is refused).
- **Actual:** Two records. Payroll and the reports add both, so the day is paid twice. The frontend avoids it when it can (its BUG-015 / BUG-209 fixes) but the server doesn't guard it.
- **Suggested fix:** A unique index on `{ companyId, emp_id, shift_id, work_date }` and an upsert (`findOneAndUpdate(…, { upsert: true })`) in `create`. Clean existing duplicates first.
- **Status:** Open

### BUG-402: Advances and bonuses are accepted for an employee who doesn't exist
- **Severity:** Low
- **Type:** Bug (validation)
- **Location:** `src/advances/advances.service.ts` `create`, `src/bonuses/bonuses.service.ts` `create`
- **Found by:** `payroll.e2e-spec.ts` › "refuses an advance or a bonus for an employee who does not exist"
- **Steps / input:** `POST /advances` or `POST /bonuses` with `emp_id: 999` (no such employee number).
- **Expected:** 400 "Employee not found".
- **Actual:** Saved. The money appears in no payslip, and appears on the employee who later gets number 999.
- **Suggested fix:** Check `employeeModel.exists({ empNumber: emp_id })` (company-scoped by the tenant plugin) before saving.
- **Status:** Open

## Observations (not bugs, to confirm)

## Fixed issues
