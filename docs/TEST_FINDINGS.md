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

Run: `npm test`, `npm run test:cov` (report in `coverage/index.html`), `npm run test:security`.
The plan is in [TEST_PLAN.md](TEST_PLAN.md).

## Coverage progress

| Date | Phase | Lines | Branches | Functions | Notes |
|------|-------|-------|----------|-----------|-------|
| 2026-10-28 | Baseline (`dev` @ 72bbece) | 9.94% (288/2897) | 12.5% | 10.85% | 18 unit tests in 4 files. The 19 security tests aren't counted (46% lines on their own). `test:e2e` doesn't run |
| 2026-10-28 | 0: tooling | 54.49% (1565/2872) | 40.33% | 40.5% | One config, unit + integration measured together (the security tests now count). 41 tests in 6 files. `main.ts` excluded. Thresholds set to 54/54/40/40. Lines are high because booting the app runs every module and schema file: branches are the honest number |

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

- `GET /` answers 404: `AppController` / `AppService` ("Hello World!") exist and have a unit test, but
  `AppModule` doesn't register them. If Render or an uptime check pings `/`, it gets a 404. Either
  register them (as a health check) or delete the two files and their test.

## Fixed issues

## Coverage exclusions

| File / lines | Why |
|--------------|-----|
| `src/main.ts` | Starts a real server on a port and installs process-wide crash handlers. Everything it configures is in `app.setup.ts`, which the integration tests run |

## Tooling notes

- **Fixed in Phase 0:** `npm run test:e2e` didn't run (`test/jest-e2e.json` matched
  `security.e2e-spec.ts` without its ts-jest settings), and the security config's `rootDir` (`test/`)
  made `--coverage` measure nothing. Both configs are replaced by `jest.config.js` (projects `unit` and
  `integration`); `test/tsconfig.security.json` is now `test/tsconfig.json`, used by both.
- `testTimeout` only works at the root of `jest.config.js`, not inside a project: set there to 30 s,
  because booting the app from a cold ts-jest cache takes more than the default 5 s.
- ESLint: the `no-unsafe-*` rules are off for test files (supertest bodies and lean documents are
  `any`). `jest.config.js` is ignored like `eslint.config.mjs`.
- `test/security.e2e-spec.ts` still has Windows line endings in the working copy and fails Prettier;
  it moves onto the shared helpers in Phase 2.
- `npm run lint` runs `eslint --fix`, which rewrites files. CI must run `eslint` without `--fix`.

## Refactors made to enable testing
