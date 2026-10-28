# Test findings: planning

Bugs found while testing `src/planning/*`: CRUD, bulk save, copying days and weeks, import, Excel and PDF exports.
Each bug has a test marked `it.failing(...)` with a `// BUG-3NN` comment above it. The test describes the
**correct** behaviour and currently fails. Entry format: see [../TEST_FINDINGS.md](../TEST_FINDINGS.md).

## Open issues

Sorted by severity.

### BUG-301: Copying a month without the months crashes with a 500
- **Severity:** Low
- **Type:** Bug
- **Location:** `src/planning/planning.controller.ts` `copyMonth` → `src/planning/planning.service.ts` `copyMonth` (`sourceMonth.split("-")`)
- **Found by:** `access.e2e-spec.ts` › "POST /planning/copy-month as admin"
- **Steps / input:** `POST /planning/copy-month` with `{}`, or with a value that isn't a month.
- **Expected:** 400 with a plain message ("Choose the month to copy and the month to copy to").
- **Actual:** 500 "Something went wrong on our side": `undefined.split` throws a TypeError, which is saved to the error log as a crash.
- **Suggested fix:** Check both values with `/^\d{4}-(0[1-9]|1[0-2])$/` before anything else.
- **Status:** Open

## Observations (not bugs, to confirm)

## Fixed issues
