# Test coverage work: where we are and how to continue

Handoff notes so the work can be picked up in a new session (person or Claude).
Last updated: **2026-10-29, after Phase 4.** Read this first, then [TEST_PLAN.md](TEST_PLAN.md),
[TESTING.md](TESTING.md) and [TEST_FINDINGS.md](TEST_FINDINGS.md).

## The task

Bring the backend (`C:\codzza\FinalBackEndOtherVersion`, NestJS + MongoDB) to **≥ 90% lines and ≥ 85%
branches**, and while doing it log every bug found the same way as in the frontend project
(`C:\codzza\FinalFrontEndOtherVersion`, see its `docs/TEST_FINDINGS.md` and `docs/findings/`): one test per bug
describing the correct behaviour, marked `it.failing`, with a `// BUG-XXX:` comment, and an entry in the
findings files. At the end: Bug Report and Stability Assessment documents for the team, like the frontend's
`docs/Bug-Report.pdf` and `docs/Stability-Assessment.pdf`.

## State

- **Branch:** `test/coverage`, made from `origin/dev` (72bbece). Not pushed. Working tree clean.
- **Commits** (one per phase):

  | Commit | Phase | Lines | Branches | Functions | Tests | Bugs |
  |--------|-------|-------|----------|-----------|-------|------|
  | 8ef96a2 | Plan + empty findings log | 9.9% (unit only) | 12.5% | 10.9% | 18 | |
  | 472563b | 0: tooling | 54.5% | 40.3% | 40.5% | 41 | |
  | fbeb27a | 1: pure logic | 60.0% | 55.6% | 53.2% | 228 | 4 |
  | 4e5f3aa | 2: auth, users, companies, access | 74.4% | 71.1% | 81.5% | 681 | 4 |
  | fb9c137 | 3: day-to-day data | 75.9% | 75.7% | 83.0% | 760 | 10 |
  | b03222a | 4: planning | **91.6%** | **81.7%** | 94.4% | 795 | 6 |

- **Line target reached. Still to do:** branches 81.7% → 85%, Phase 5, Phase 6, Phase 7, final reports.
- **Coverage thresholds** in `jest.config.js`: lines 91, statements 91, branches 81, functions 94.
  Raise them at the end of every phase.
- **24 open bugs: 0 High, 7 Medium, 17 Low**, all with an `it.failing` test. The list by severity is in
  `TEST_FINDINGS.md`; full entries in `TEST_FINDINGS.md` (BUG-0xx) and `docs/findings/*.md`.

## Next: Phase 5, attendance, kiosk and clocking machines

What is left uncovered (from the last coverage run):

| File | Lines | Branches | Size |
|------|-------|----------|------|
| `src/zkteco/zkteco.service.ts` | 14% | 0% | 167 lines |
| `src/zkteco/zkteco.controller.ts` | 30% | 0% | 152 (public `/iclock/*` routes, the machine pushes punches, authorised by device serial) |
| `src/attendance/kiosk.controller.ts` | 32% | 5% | 305 (kiosk accounts clock employees in/out) |
| `src/attendance/attendance.service.ts` | 45% | 28% | 323 (`syncLogs`, `getDeviceLogs`, `getLogsByDateRange`, `deleteDeviceLog`) |
| `src/attendance/attendance.controller.ts` | 81% | 17% | 124 |
| `src/attendance-device/*` | 77–88% | 0–67% | 133 (`/device/*`, uses `node-zklib`) |
| small rest | | | `app.setup.ts` 58,74 (CORS origins), `auth.module.ts` 43,51-53 (JWT secret checks), `sessions.service.ts` 257-267 |

Plan for it (new files `test/attendance.e2e-spec.ts`, `test/kiosk.e2e-spec.ts`, `test/zkteco.e2e-spec.ts`):

1. **Read the code first** (all of it, in full: a quick filtered read once produced two false bugs).
2. `/iclock/*` (ZKTeco ADMS push protocol, plain HTTP allowed): device serial → company lookup
   (`companies.service.findByDeviceSerial`), unknown serial, bad payloads, punches stored in the right company,
   duplicates, `@SkipAudit`. Send raw `text/plain` bodies like the machine does (`express.text` in `app.setup.ts`).
3. Kiosk: `GET /kiosk/employees`, `POST /kiosk/clock` (in / out, "already clocked in", "isn't clocked in yet",
   feature `clockin` off, kiosk account vs admin/manager), what it writes to worktime and the activity log
   (`kiosk.clockIn` / `kiosk.clockOut`), times in Algeria (UTC+1), around midnight and night shifts.
4. Attendance: `POST /attendance/sync` with the fake device (`test/helpers/fake-zklib.ts`:
   `fakeDevice.attendances`, `.users`, `.reachable = false`; call `fakeDevice.reset()` in `afterEach`),
   `GET /attendance/device-logs` by day and range in Algeria time, add / edit / delete a punch.
5. **Check the observation from Phase 2:** the `/device/*` routes all use one `DEVICE_IP` env var, whichever
   company asks. If company A can read company B's machine (users, logs), that is a **security bug** (likely
   High): write it as a failing test.
6. Raise thresholds, update `TEST_FINDINGS.md` (coverage row, bugs, observations), `TEST_PLAN.md` (phase done),
   commit `test: phase 5 …`.

Bug numbers for Phase 5: **BUG-501…** in `docs/findings/attendance.md` (still empty).
Next free numbers elsewhere: BUG-006 (common/audit), BUG-105 (auth/companies), BUG-206 (staff),
BUG-308 (planning), BUG-404 (payroll).

## After that

- **Phase 6 (branches ≥ 85%):** go file by file through `npm run test:cov` worst branches first; error paths
  (invalid ids, DB errors), rare branches. Run the whole suite with coverage 3–4 times to make sure it is stable.
- **Phase 7 (CI):** GitHub Actions on push/PR to `dev` and `main`: `npm ci`, `npx eslint "{src,test}/**/*.ts"`
  (**not** `npm run lint`, which has `--fix`), `npm run build`, `npm run test:cov`.
  Lint of `src/` currently has errors that are not ours (pre-existing); decide with the user whether CI lints
  only `test/` for now.
- **Final deliverables:** update `TEST_FINDINGS.md`, then make Bug Report and Stability Assessment documents
  (ask the user which format: the frontend ones are PDFs in `docs/`). Then the team fixes the bugs on `dev`,
  and we can verify the fixes as we did for the frontend: count the `it.failing` markers left on `dev`, run
  the suite, and check that test changes were only `it.failing` → `it` (plus justified ones).

## How to work (rules that matter)

- **Never change application code** (`src/**/*.ts` except `*.spec.ts`). Tests and docs only. If code is wrong,
  write the test for the correct behaviour with `it.failing` and log the bug.
- **Never run `npm run lint` or `eslint --fix` on `src/`**: it reformats ~90 application files (happened once in
  Phase 2; restored from git). Lint/format only the test files you touched:
  `npx prettier --write <files>` then `npx eslint <files>`.
- Before each commit: `npx eslint test` + changed `src/**/*.spec.ts`, `npm run test:cov` **twice**,
  `npm run build`, and `git diff --ignore-cr-at-eol --stat -- src ':!*.spec.ts'` must be empty.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push unless asked.

## Gotchas met so far

- **Mongoose queries run when awaited.** `runForCompany(id, () => model.find())` returns the query unrun and it
  then runs outside the company context → refused. Use `runForCompany(id, async () => await …)` (the `seeder`
  helper does).
- **Audit and error log entries are written after the answer.** Poll for them (`waitFor` in
  `test/logs.e2e-spec.ts`).
- **supertest:** don't build several requests and await them later (ECONNREFUSED); send each when needed.
- **Fake time:** `setNow(ms | iso)` from `test/helpers/time.ts`; `jest.useRealTimers()` in `afterEach`.
  Jest 30's `setSystemTime` refuses a Date created after faking (handled in `setNow`).
- **Time zones:** `withTimeZone('Africa/Algiers', fn)`. Planning and worktime dates are stored at UTC midnight
  from `YYYY-MM-DD`.
- **Big edits with Node scripts:** bash heredocs with quotes/backticks broke twice; write the script to the
  scratchpad with the Write tool and run `node script.js`. Escapes like `\n` or `\/` inside a script that writes
  code get lost: check the result (it broke a regex once).
- **Line endings:** the repo has `core.autocrlf=true`; LF→CRLF warnings on commit are normal.
- **Coverage stability:** one run once printed old per-file numbers; totals were right. After the Phase 4 fix
  (shared MongoDB for the security suite, `maxWorkers: '50%'`) 4 runs in a row were identical.
- `--coverage` runs take ~60–80 s; use `timeout 580 npx jest …` and per-file runs while writing tests.

## Where things are

| What | Where |
|------|-------|
| Jest config (projects `unit` + `integration`, thresholds, fake zklib) | `jest.config.js` |
| Test helpers | `test/helpers/`: `app.ts` (`createTestApp`, `api`), `seed.ts` (`seeder`, `loginAs`, `PASSWORD`, `unknownId`), `time.ts`, `files.ts` (Excel/PDF), `routes.ts` (route list for the access matrix), `fake-zklib.ts` |
| Integration tests | `test/*.e2e-spec.ts`: access (all 84 routes × callers), auth, users, companies, staff, payroll, logs, planning, tenancy, security, app |
| Unit tests | `src/**/*.spec.ts` |
| Plan / how-to / bugs | `docs/TEST_PLAN.md`, `docs/TESTING.md`, `docs/TEST_FINDINGS.md`, `docs/findings/{auth,staff,planning,payroll,attendance}.md` |
| Useful scratch scripts | `sum.js` (coverage per folder from `coverage/coverage-summary.json`, needs `--coverageReporters=json-summary`) in the Claude scratchpad; easy to rewrite |

## Commands

```
npm test                                   # all tests
npx jest test/planning                     # one file
npm run test:cov                           # all, with coverage and thresholds (coverage/index.html)
npx jest --coverage --coverageReporters=text 2>&1 | grep -E '^\s+[a-z.-]+\.ts'   # per-file table
npm run build
```
