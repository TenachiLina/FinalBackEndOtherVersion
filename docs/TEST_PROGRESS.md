# Test coverage work: where we are and how to continue

Handoff notes so the work can be picked up in a new session (person or Claude).
Last updated: **2026-10-29, after Phase 7.** Read this first, then [TEST_PLAN.md](TEST_PLAN.md),
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
  | b03222a | 4: planning | 91.6% | 81.7% | 94.4% | 795 | 6 |
  | 1216079 | 5: attendance, kiosk, devices | 99.1% | 92.2% | 99.3% | 889 | 5 |
  | f2b065d | 6: close the gaps | **99.8%** | **93.7%** | 99.5% | 923 | 0 |
  | (Phase 7 commit) | 7: CI (`.github/workflows/ci.yml`) | | | | 923 | |

- **Both targets reached** (≥ 90% lines, ≥ 85% branches). Still to do: push and watch the first CI run, final reports.
- **Coverage thresholds** in `jest.config.js`: lines 99, statements 99, branches 93, functions 99.
  Raise them at the end of every phase.
- **29 open bugs: 1 High, 10 Medium, 18 Low**, all with an `it.failing` test. The list by severity is in
  `TEST_FINDINGS.md`; full entries in `TEST_FINDINGS.md` (BUG-0xx) and `docs/findings/*.md`.

## Next: first CI run, then the final reports

Phase 7 is done: `.github/workflows/ci.yml` (Node 22, `npm ci`, lint of `test/**/*.ts` and
`src/**/*.spec.ts`, build, `npm run test:cov`, coverage report as an artifact, MongoDB binary cached).
The user chose to lint only the tests for now; `src/` has older lint errors. How it works is in
`docs/TESTING.md` › CI.

1. **Not run yet**: it only runs once pushed to GitHub. Pushing `test/coverage` and opening a PR to `dev`
   needs the user's go-ahead. On the first run, check the MongoDB download works on the runner and the
   time (locally ~70 s for the tests).
2. **Final deliverables:** update `TEST_FINDINGS.md`, then make Bug Report and Stability Assessment
   documents (ask the user which format: the frontend ones are PDFs in `docs/`).
3. Then the team fixes the bugs on `dev` (BUG-501, High, first), and we verify the fixes as for the
   frontend: count the `it.failing` markers left on `dev`, run the suite, and check that test changes were
   only `it.failing` → `it` (plus justified ones).

Next free bug numbers: BUG-006 (common/audit), BUG-105 (auth/companies), BUG-206 (staff),
BUG-308 (planning), BUG-404 (payroll), BUG-506 (attendance).

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
  Access tokens live 15 minutes of *fake* time too: after moving the clock, log in again (the `at()` helper
  in `test/kiosk.e2e-spec.ts`).
  Jest 30's `setSystemTime` refuses a Date created after faking (handled in `setNow`).
- **Time zones:** `withTimeZone('Africa/Algiers', fn)`. Planning and worktime dates are stored at UTC midnight
  from `YYYY-MM-DD`.
- **A start-up that fails** (`createTestApp()` rejecting) leaves its MongoDB connection open and Jest
  doesn't exit: close `mongoose.connections` afterwards (see `test/config.e2e-spec.ts`).
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
| Integration tests | `test/*.e2e-spec.ts`: access (all 84 routes × callers), config (JWT secret, CORS), auth, users, companies, staff, payroll, logs, planning, attendance, kiosk, zkteco, tenancy, security, app |
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
