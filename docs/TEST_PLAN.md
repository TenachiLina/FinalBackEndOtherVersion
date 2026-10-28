# Test coverage plan: 10% → 90%

Goal: **≥ 90% lines, statements and functions, ≥ 85% branches**, measured over all of `src/` by one
command (`npm run test:cov`), enforced in CI. Bugs found on the way are logged in
[TEST_FINDINGS.md](TEST_FINDINGS.md), the same way as in the frontend project.

## Where we start (2026-10-28, branch `dev` @ 72bbece)

| Suite | Tests | Lines | Branches | Functions | Notes |
|-------|-------|-------|----------|-----------|-------|
| Unit (`npm run test:cov`) | 18 in 4 files | **9.94%** (288/2897) | 12.5% | 10.85% | Only `audit-changes`, `manager-visibility.service`, `error-reporter`, `app.controller` |
| Security (`npm run test:security`) | 19 in 1 file | 46% (not counted today) | 31% | 28% | Real app + in-memory MongoDB. Covers login, tokens, sessions, users. Most of its 46% is module/schema code that runs on boot |
| E2E (`npm run test:e2e`) | 0 run | n/a | n/a | n/a | **Broken**: its config also picks up `security.e2e-spec.ts` without the TypeScript settings it needs, so both files fail to parse |

Lines that count, per folder (the 90% target leaves room for only ~290 uncovered lines in total):

| Folder | Lines | Covered now | Phase |
|--------|------:|------------:|-------|
| `planning` | 586 | 0 | 4 |
| `auth` | 549 | 13 | 2 |
| `audit` | 351 | 180 | 1, 3 |
| `attendance` | 229 | 0 | 5 |
| `error-logs` | 176 | 53 | 1, 3 |
| `common` | 173 | 0 | 1 |
| `companies` | 146 | 0 | 2 |
| `zkteco` (+ schemas) | 133 | 0 | 5 |
| `employees` | 83 | 23 | 3 |
| root (`app.*`, `main.ts`) | 80 | 10 | 0 |
| `worktime` | 77 | 0 | 3 |
| `attendance-device` | 63 | 0 | 5 |
| `advances` | 59 | 0 | 3 |
| `bonuses` | 57 | 0 | 3 |
| `tenancy` | 55 | 9 | 1 |
| `shifts` | 45 | 0 | 3 |
| `tasks` | 35 | 0 | 3 |

## Approach

Most services are thin layers over Mongoose, and multi-tenancy lives in a Mongoose plugin
(`tenancy/tenant.plugin.ts`). Mocking Mongoose would test the mocks, not the code, and would miss
the most dangerous bug class (one company seeing another's data). So:

- **Integration tests are the main tool**: the real Nest app, a throw-away MongoDB
  (`mongodb-memory-server`, already a dependency) and HTTP calls with `supertest`, exactly like
  `test/security.e2e-spec.ts` does today. They test controllers, guards, pipes, the exception filter,
  the audit interceptor, services and schemas together.
- **Unit tests** for pure logic: `common/*`, `audit-changes`, `error-reporter`, `backups.util`,
  device/client parsing, time and date helpers.
- **Only hardware and outside services are mocked**: `node-zklib` (the ZKTeco clock),
  and the clock (`jest.useFakeTimers({ doNotFake: [...] })` + `setSystemTime`).
- **Time zones**: the restaurants run in Algeria (UTC+1, no DST) and the frontend had about 20
  date/time-zone bugs. Date-sensitive suites run under `TZ=UTC` *and* `TZ=Africa/Algiers`, and test
  around midnight, overnight shifts and month ends.

## Rules (same as the frontend)

1. **When the code is wrong, don't bend the test.** Write the test for the correct behaviour, mark it
   `it.failing(...)` (Jest's `it.fails`), put `// BUG-0XX: <one line>` on the line above, and add the
   entry to `docs/TEST_FINDINGS.md` or the area file. When the bug is fixed the test "passes
   unexpectedly" and Jest fails it: change `it.failing` to `it` and move the entry to **Fixed issues**.
2. **Don't change application code while writing tests.** Fixes go in their own commits
   (`fix(BUG-0XX): …`), on fix branches, after the report is shared.
3. **Test behaviour through the API**: status codes, response bodies, what is stored, what is
   audited. Not private methods.
4. **Every route gets the access checks**: no token → 401, wrong role → 403, another company's id →
   404/403 and nothing leaked or changed.
5. **Tests are independent**: each file gets its own database (or a wipe between tests), its own IPs
   for the rate limiter, and restores `process.env` and timers.
6. **Coverage exclusions are listed and justified** in `TEST_FINDINGS.md`, never added silently.

## Phases

Each phase ends with a commit, the coverage row in `TEST_FINDINGS.md` updated, and the threshold in
the Jest config raised to the new level, so coverage can't drop afterwards.

After Phase 0 the security tests count too, so the starting point is **54.5% lines but only 40%
branches and 40% functions**: booting the app runs every module and schema file. The targets below
are the merged numbers (lines / branches).

### Phase 0: tooling (done: 54.5% / 40%, one command measures everything)
- One Jest config with two `projects`: `unit` (`src/**/*.spec.ts`) and `integration`
  (`test/**/*.e2e-spec.ts`, `--runInBand`-safe, memory MongoDB). `npm run test:cov` merges both.
- Fix `npm run test:e2e` (separate the two configs or replace them with the projects above).
- Test helpers in `test/helpers/`:
  - `createTestApp()`: memory MongoDB, test env (`JWT_SECRET`, `FORCE_HTTPS`, `TRUST_PROXY`…),
    `configureApp(app)`, returns `{ app, models, close }`.
  - `seed`: `makeCompany`, `makeUser(role)`, `makeEmployee`, `makeShift`, `makePlanning`,
    `makeWorktime`, `makeAdvance`, `makeBonus`, with two companies by default for isolation tests.
  - `loginAs(role, company)`: returns a request agent with a valid token and a fresh IP.
  - `zklibMock`: a fake ZKTeco device (`getAttendances`, `getUsers`, connection errors).
- `coverageThreshold` set to the baseline. Exclude only `src/main.ts` (bootstrap, starts a real
  server) and comment-only blocks, and document why.
- `docs/TESTING.md`: how to run, helpers, rules.

### Phase 1: pure logic (done: 60.0% / 55.6%)
`common/security.ts`, `common/sanitize.ts`, `common/all-exceptions.filter.ts`,
`common/messages.i18n.ts`, `tenancy/tenant-context.ts`, `tenancy/tenant.plugin.ts` (with a memory
DB: reads, writes, `runAsSystem`, missing context → `TenantContextError`), `auth/device.ts`,
`auth/client-info.ts`, `auth/security.config.ts`, `planning/backups.util.ts`, `audit/audit-actions.ts`,
the rest of `audit-changes.ts` and `error-reporter.ts`, `error-logs/app-logger.ts`.

### Phase 2: auth, users, companies and access control (done: 74.4% / 71.1%)
Move `security.e2e-spec.ts` onto the shared helpers. Then: `auth.controller`, `auth.guard`,
`auth.decorators`, `sessions.*`, `users.*`, `companies.controller` and `companies.service`
(branding, device serials, feature flags, slug lookups).
Plus a **route matrix** test that lists all 84 routes with the roles allowed on each and checks
401/403 and cross-company isolation for every one. This is where security bugs show up.

### Phase 3: day-to-day data (done: 75.9% / 75.7%)
`employees`, `shifts`, `tasks`, `advances`, `bonuses`, `worktime` (`findAll` filters,
`findForReport` date ranges, upserts, one record per employee and shift per day),
`audit.interceptor` / `audit.service` / `audit.controller` (every write is audited, with the
right actor and changes), `error-logs.service` / `error-logs.controller`.

### Phase 4: planning (done: 91.6% / 81.7%)
`planning.service.ts` is the biggest file (2,523 lines, 493 coverable) and has large near-duplicate
blocks (week export with and without backups, Excel and PDF).
- CRUD, `findAll` filters, `bulkSave` (replaces a day's planning, keeps other days), duplicate
  clean-up.
- Copying a day / week / weekday pattern (lines ~2200–2500), across months and time zones.
- `importFromDate`.
- Exports: Excel files are read back with `exceljs` and checked cell by cell (employees, hours,
  backups, tasks). PDFs are checked for type, page count and text content.
- Duplication is logged under **Observations** for a later refactor. Not refactored now (rule 2).

### Phase 5: attendance, kiosk and devices (target ≈ 95% / 85%)
`attendance.service` (`syncLogs` with the mocked device: new, duplicate, unknown-user and
connection-failure punches; `getLogsByDateRange` around midnight in Algiers), `kiosk.controller`
(kiosk accounts, feature off, face/PIN flows), `zkteco.controller` / `zkteco.service` (device push
endpoints, serial → company lookup, bad payloads), `attendance-device.*`.

### Phase 6: close the gaps (target ≥ 90% lines, ≥ 85% branches)
Go file by file through the coverage report, worst first: error paths (invalid ObjectId, DB errors,
validation failures, not-found), rare branches, i18n fallbacks. Raise the thresholds to the target.
Run the full suite twice in a row to make sure it is stable.

### Phase 7: CI
GitHub Actions on every push / PR to `dev` and `main`: install, lint (without `--fix`; the `lint`
script fixes files, so CI needs `eslint .`), build, `npm run test:cov` with thresholds.

## Deliverables
- Tests + helpers on branch `test/coverage` (from `dev`), one commit per phase.
- `docs/TESTING.md`: how to write and run tests.
- `docs/TEST_FINDINGS.md` + `docs/findings/*.md`: the bug list, by area and severity.
- When done: Bug Report and Stability Assessment documents for the team, as for the frontend.
