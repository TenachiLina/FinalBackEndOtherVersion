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
| 2026-10-28 | 1: pure logic | 60.02% (1724/2872) | 55.6% | 53.22% | 228 tests in 18 files (+187). `common`, `tenancy`, `audit-actions`, `error-reporter`, `app-logger`, `device`, `client-info`, `security.config`, `backups.util` at 100% lines; `audit-changes` 99.5%. 4 bugs found. Thresholds 60/61/55/53 |

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

**4 open bugs: 0 High, 0 Medium, 4 Low.** Details (steps, expected, actual, suggested fix) are in the area files linked from each row.

| ID | Severity | Area | Bug |
|----|----------|------|-----|
| [BUG-001](#bug-001-a-mongodb-operator-nested-more-than-20-levels-deep-gets-past-the-injection-check) | Low | Common | A MongoDB operator nested more than 20 levels deep gets past the injection check |
| [BUG-002](#bug-002-two-error-messages-reach-french-and-arabic-users-in-english) | Low | Common | Two error messages reach French and Arabic users in English |
| [BUG-003](#bug-003-a-clock-out-at-exactly-0000-is-logged-as-clock-out-time-changed) | Low | Audit | A clock-out at exactly 00:00 is logged as "Clock-out time: Changed" |
| [BUG-101](findings/auth.md#bug-101-chrome-firefox-and-edge-on-phones-are-listed-as-another-browser) | Low | Auth | Chrome, Firefox and Edge on phones are listed as another browser |

## Open issues: common, tenancy, app setup, error logs, audit

Sorted by severity.

### BUG-001: A MongoDB operator nested more than 20 levels deep gets past the injection check
- **Severity:** Low
- **Type:** Security
- **Location:** `src/common/security.ts`, `hasForbiddenKey` (used by `rejectInjection`)
- **Found by:** `security.spec.ts` › "finds an operator hidden deeper than 20 levels"
- **Steps / input:** Send a body like `{"a":{"a":{ … 25 levels … {"$ne":""}}}}`.
- **Expected:** 400 "The data sent was not valid", like the same operator at a shallow level.
- **Actual:** The request goes through: `hasForbiddenKey` stops looking after 20 levels and answers `false` ("nothing found"), so the deep part is never checked. Today no route reads a field that deep, so the risk is low, but the check fails open.
- **Suggested fix:** Fail closed: `if (depth > 20) return true;` (a real form never nests that deep).
- **Status:** Open

### BUG-002: Two error messages reach French and Arabic users in English
- **Severity:** Low
- **Type:** Bug (translation)
- **Location:** `src/advances/advances.service.ts` (`An advance for employee … on … already exists.`), `src/worktime/worktime.service.ts` (`Worktime with id … not found`); no matching pattern in `src/common/messages.i18n.ts`
- **Found by:** `messages.i18n.spec.ts` › "translates "An advance for employee 12 on 2026-10-20 already exists."" / "translates "Worktime with id … not found""
- **Steps / input:** With the app in French or Arabic, give an employee a second advance on the same day, or edit a worktime that was deleted meanwhile.
- **Expected:** The message in the user's language, like every other API error.
- **Actual:** The English text. They are built with a variable part, and `PATTERNS` has no entry for them (every fixed message and every other variable message is translated).
- **Suggested fix:** Add two patterns, e.g. `/^An advance for employee (.+) on (.+) already exists.?$/` and `/^Worktime with id .+ not found$/`. The worktime one shouldn't show the database id at all: "This work time record no longer exists".
- **Status:** Open

### BUG-003: A clock-out at exactly 00:00 is logged as "Clock-out time: Changed"
- **Severity:** Low
- **Type:** Bug
- **Location:** `src/audit/audit-changes.ts`, `isBlank` and `clockTime` (both treat `"00:00"` as "no time")
- **Found by:** `audit-changes.spec.ts` › "logs a clock-out at exactly 00:00 (end of a night shift) as a clock-out"
- **Steps / input:** Night shift 16:00–00:00. The employee clocks out at exactly 00:00 (the page saves `clock_out: "00:00"` with `X-Audit-As: clock`).
- **Expected:** Activity log: "Clocked out at 00:00".
- **Actual:** "Clock-out time: Changed", with no time. `"00:00"` is how the backend used to store "not clocked yet", so the log hides it. The frontend now counts a 00:00 punch as a real time (frontend BUG-103) and sends `""` for "no time".
- **Suggested fix:** Treat only `""`/`null` as "no time" in `isBlank` for clock fields and in `clockTime`. Check the worktime schema default (`clock_in`/`clock_out` default `"00:00"`) in Phase 3: the same ambiguity exists there.
- **Status:** Open

### Entry format

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

- `runForCompany(id, () => model.find())` and `runAsSystem(...)` return the query *unrun*: Mongoose runs it
  when it is awaited, which is outside the company context, so the tenant plugin refuses it. No app code
  uses these helpers today (the auth guard and the ZKTeco controller set the company per request), but
  the next person to use them will hit this. Write `runForCompany(id, async () => await model.find())`, or
  make the helpers await what `fn` returns. (The test helpers do this.)
- The tenant plugin is solid: 19 tests against a real MongoDB found no way to read, change, move or
  delete another company's records, and nothing runs without a company (it fails closed).
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
