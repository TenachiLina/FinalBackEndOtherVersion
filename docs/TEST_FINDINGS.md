# Test Findings Log

Problems found while writing tests. Each bug has a test marked `it.failing(...)`
with a `// BUG-0XX` comment above it: the test describes the **correct**
behaviour and currently fails. When the bug is fixed, that test starts
passing, which makes Jest fail it: change `it.failing` to `it`
and move the entry to **Fixed issues**.

Rules:
- Never change a test to make it pass when the code is wrong: log it here.
- Add the entry when the problem is found, before fixing it.
- One fix per commit: `fix(BUG-0XX): <title>`.

Run: `npm test`, `npm run test:cov` (report in `coverage/lcov-report/index.html`), `npm run test:security`.
The plan is in [TEST_PLAN.md](TEST_PLAN.md).

## Coverage progress

| Date | Phase | Lines | Branches | Functions | Notes |
|------|-------|-------|----------|-----------|-------|
| 2026-10-28 | Baseline (`dev` @ 72bbece) | 9.94% (288/2897) | 12.5% | 10.85% | 18 unit tests in 4 files. The 19 security tests aren't counted (46% lines on their own). `test:e2e` doesn't run |

## Bug files

Bugs are numbered by area. Each area file has the full entries plus an Observations section.

| IDs | Area | File |
|-----|------|------|
| BUG-001 – 099 | `common`, `tenancy`, app setup, error logs, audit | this file, below |
| BUG-101 – 199 | Auth, users, sessions, companies, access control per route | [findings/auth.md](findings/auth.md) |
| BUG-201 – 299 | Employees, shifts, tasks | [findings/staff.md](findings/staff.md) |
| BUG-301 – 399 | Planning: CRUD, copy, import, Excel/PDF exports | [findings/planning.md](findings/planning.md) |
| BUG-401 – 499 | Worktime, advances, bonuses | [findings/payroll.md](findings/payroll.md) |
| BUG-501 – 599 | Attendance, kiosk, ZKTeco, attendance devices | [findings/attendance.md](findings/attendance.md) |

## All open bugs, by severity

**0 open bugs.** Details (steps, expected, actual, suggested fix) are in the area files linked from each row.

| ID | Severity | Area | Bug |
|----|----------|------|-----|

## Open issues: common, tenancy, app setup, error logs, audit

None yet. Entry format:

```
### BUG-0XX: <what goes wrong, in plain words>
- **Severity:** High | Medium | Low
- **Type:** Bug | Security | Data loss | Performance
- **Location:** `src/...`, `functionName`
- **Found by:** `file.spec.ts` › "test name"
- **Steps / input:** request, body, data in the database
- **Expected:** …
- **Actual:** …
- **Suggested fix:** …
- **Status:** Open
```

## Observations (not bugs, to confirm)

## Fixed issues

## Coverage exclusions

| File / lines | Why |
|--------------|-----|

## Tooling notes

- `npm run test:e2e` doesn't run: `test/jest-e2e.json` matches every `*.e2e-spec.ts`, including
  `security.e2e-spec.ts`, but lacks its ts-jest settings (`test/tsconfig.security.json`,
  `transformIgnorePatterns` for `@nestjs/jwt`), so both files fail to parse. To fix in Phase 0.
- The security suite's config has `rootDir: "."` (the `test/` folder), so `--coverage` measures
  nothing; its coverage was measured with a temporary config rooted at the project.
- `npm run lint` runs `eslint --fix`, which rewrites files. CI must run `eslint` without `--fix`.

## Refactors made to enable testing
