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
The plan is in [TEST_PLAN.md](TEST_PLAN.md). For the team: `Bug-Report.pdf` (every bug with its effect) and
`Stability-Assessment.pdf` (scores), made from this log by `docs/reports/` (see the comment at the top of each script).

## Coverage progress

| Date | Phase | Lines | Branches | Functions | Notes |
|------|-------|-------|----------|-----------|-------|
| 2026-10-28 | Baseline (`dev` @ 72bbece) | 9.94% (288/2897) | 12.5% | 10.85% | 18 unit tests in 4 files. The 19 security tests aren't counted (46% lines on their own). `test:e2e` doesn't run |
| 2026-10-28 | 0: tooling | 54.49% (1565/2872) | 40.33% | 40.5% | One config, unit + integration measured together (the security tests now count). 41 tests in 6 files. `main.ts` excluded. Thresholds set to 54/54/40/40. Lines are high because booting the app runs every module and schema file: branches are the honest number |
| 2026-10-28 | 1: pure logic | 60.02% (1724/2872) | 55.6% | 53.22% | 228 tests in 18 files (+187). `common`, `tenancy`, `audit-actions`, `error-reporter`, `app-logger`, `device`, `client-info`, `security.config`, `backups.util` at 100% lines; `audit-changes` 99.5%. 4 bugs found. Thresholds 60/61/55/53 |
| 2026-10-28 | 2: auth, users, companies, access | 74.37% (2136/2872) | 71.09% | 81.54% | 681 tests in 22 files (+453). Every route checked against every kind of caller (358 checks). `auth.guard` 98%, `users.service` 100%, `sessions.service` 92%, `companies.service` 98% lines. 4 bugs found. Thresholds 74/75/71/81 |
| 2026-10-28 | 3: day-to-day data | 75.90% (2180/2872) | 75.73% | 82.97% | 760 tests in 26 files (+79). Employees, shifts, tasks, advances, bonuses, worktime, activity and error logs: every service 100% lines, controllers 100%, `audit.interceptor` 100%. 10 bugs found. Below the 80% line target because the rest is planning and attendance (Phases 4–5). Thresholds 75/77/75/82 |
| 2026-10-29 | 4: planning | 91.57% (2630/2872) | 81.65% | 94.44% | 795 tests in 27 files (+35). `planning.service.ts` 11% → 99% lines: saving, import, copy-month, and the six exports read back cell by cell (Excel) or as text (PDF). 6 bugs found. Same result on 4 runs in a row. Thresholds 91/91/81/94 |
| 2026-10-29 | 5: attendance, kiosk, devices | 99.05% | 92.16% | 99.28% | 889 tests in 30 files (+94). ZKTeco push (`/iclock`), kiosk clock-in/out with day, night and past-midnight shifts, sync from the machine, Clock-in History, `/device/*`: every file 100% lines except `zkteco.service` (98%). Branch target (85%) passed as well. 5 bugs found, 1 High. Thresholds 99/98/92/99 |
| 2026-10-29 | 6: close the gaps | **99.79% (2866/2872)** | **93.73%** | 99.46% | 923 tests in 31 files (+34). JWT secret checks at start-up and CORS origins (new `config.e2e-spec.ts`), tokens signed with the right secret but no real session, an account that lost its company, session activity, log writes that fail, exports with deleted employees/shifts. Same totals on 4 runs in a row. No new bugs. Thresholds 99/99/93/99 |

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

**29 open bugs: 1 High, 10 Medium, 18 Low.** Details (steps, expected, actual, suggested fix) are in the area files linked from each row.

| ID | Severity | Area | Bug |
|----|----------|------|-----|
| [BUG-501](findings/attendance.md#bug-501-every-company-reads-the-same-clocking-machine-so-one-company-gets-anothers-punches) | **High** | Attendance | Every company reads the same clocking machine, so one company gets another's punches |
| [BUG-203](findings/staff.md#bug-203-a-manager-can-raise-their-own-salary) | Medium | Employees | A manager can raise their own salary |
| [BUG-204](findings/staff.md#bug-204-a-shift-still-used-in-the-planning-is-deleted-at-once) | Medium | Shifts | A shift still used in the planning is deleted at once |
| [BUG-401](findings/payroll.md#bug-401-an-advance-of-0-or-a-negative-amount-is-accepted) | Medium | Payroll | An advance of 0 or a negative amount is accepted |
| [BUG-403](findings/payroll.md#bug-403-two-work-time-records-can-be-saved-for-the-same-employee-shift-and-day) | Medium | Payroll | Two work time records can be saved for the same employee, shift and day |
| [BUG-502](findings/attendance.md#bug-502-after-the-machines-log-is-cleared-its-new-punches-are-dropped-without-a-word) | Medium | Attendance | After the machine's log is cleared, its new punches are dropped without a word |
| [BUG-504](findings/attendance.md#bug-504-after-a-normal-day-the-kiosk-thinks-the-employee-is-still-clocked-in-the-next-morning) | Medium | Kiosk | After a normal day, the kiosk thinks the employee is still clocked in the next morning |
| [BUG-505](findings/attendance.md#bug-505-overtime-after-midnight-is-lost-unless-the-shift-ends-at-exactly-0000) | Medium | Kiosk | Overtime after midnight is lost unless the shift ends at exactly 00:00 |
| [BUG-001](#bug-001-a-mongodb-operator-nested-more-than-20-levels-deep-gets-past-the-injection-check) | Low | Common | A MongoDB operator nested more than 20 levels deep gets past the injection check |
| [BUG-002](#bug-002-two-error-messages-reach-french-and-arabic-users-in-english) | Low | Common | Two error messages reach French and Arabic users in English |
| [BUG-003](#bug-003-a-clock-out-at-exactly-0000-is-logged-as-clock-out-time-changed) | Low | Audit | A clock-out at exactly 00:00 is logged as "Clock-out time: Changed" |
| [BUG-306](findings/planning.md#bug-306-the-exports-leave-out-shifts-starting-at-1300-before-0600-and-in-the-evening) | Medium | Planning | The exports leave out shifts starting at 13:00, before 06:00 and in the evening |
| [BUG-303](findings/planning.md#bug-303-importing-a-day-crashes-when-one-of-its-employees-or-shifts-was-deleted) | Medium | Planning | Importing a day crashes when one of its employees or shifts was deleted |
| [BUG-304](findings/planning.md#bug-304-copying-a-month-deletes-the-whole-destination-month-also-the-weekdays-it-doesnt-copy) | Medium | Planning | Copying a month deletes the whole destination month, also the weekdays it doesn't copy |
| [BUG-004](#bug-004-the-activity-and-error-logs-filter-days-in-utc-so-in-algeria-0000-0059-lands-on-the-day-before) | Low | Audit | The activity and error logs filter days in UTC, so in Algeria 00:00–00:59 lands on the day before |
| [BUG-005](#bug-005-a-change-the-database-refuses-is-logged-as-a-500-with-mongooses-raw-text) | Low | Audit | A change the database refuses is logged as a 500, with Mongoose's raw text |
| [BUG-101](findings/auth.md#bug-101-chrome-firefox-and-edge-on-phones-are-listed-as-another-browser) | Low | Auth | Chrome, Firefox and Edge on phones are listed as another browser |
| [BUG-102](findings/auth.md#bug-102-two-admins-demoting-each-other-at-the-same-moment-leave-the-company-with-no-admin) | Low | Auth | Two admins demoting each other at the same moment leave the company with no admin |
| [BUG-103](findings/auth.md#bug-103-a-second-company-whose-name-gives-the-same-sign-in-link-name-cant-be-created) | Low | Companies | A second company whose name gives the same sign-in link name can't be created |
| [BUG-104](findings/auth.md#bug-104-a-weekly-advance-share-of-0-is-refused-with-a-message-saying-0-is-allowed) | Low | Companies | A weekly advance share of 0% is refused, with a message saying 0 is allowed |
| [BUG-201](findings/staff.md#bug-201-an-edit-can-empty-an-employees-name) | Low | Employees | An edit can empty an employee's name |
| [BUG-202](findings/staff.md#bug-202-an-unknown-id-answers-200-with-an-empty-body-instead-of-404) | Low | Employees, shifts, tasks | An unknown id answers 200 with an empty body instead of 404 |
| [BUG-205](findings/staff.md#bug-205-the-api-accepts-an-employee-without-an-employee-number) | Low | Employees | The API accepts an employee without an employee number |
| [BUG-301](findings/planning.md#bug-301-copying-a-month-without-the-months-crashes-with-a-500) | Low | Planning | Copying a month without the months crashes with a 500 |
| [BUG-302](findings/planning.md#bug-302-saving-a-day-without-the-list-of-entries-empties-the-day-then-crashes) | Low | Planning | Saving a day without the list of entries empties the day, then crashes |
| [BUG-305](findings/planning.md#bug-305-the-first-tuesday-of-a-copied-month-is-the-tuesday-saved-first-not-the-earliest-one) | Low | Planning | "The first Tuesday" of a copied month is the Tuesday saved first, not the earliest one |
| [BUG-307](findings/planning.md#bug-307-a-sub-task-without-a-start-time-makes-the-exports-crash) | Low | Planning | A sub-task without a start time makes the exports crash |
| [BUG-402](findings/payroll.md#bug-402-advances-and-bonuses-are-accepted-for-an-employee-who-doesnt-exist) | Low | Payroll | Advances and bonuses are accepted for an employee who doesn't exist |
| [BUG-503](findings/attendance.md#bug-503-clock-in-history-cuts-days-at-utc-midnight-so-in-algeria-0000-0059-lands-on-the-day-before) | Low | Attendance | Clock-in History cuts days at UTC midnight, so in Algeria 00:00–00:59 lands on the day before |

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
- **Suggested fix:** Treat only `""`/`null` as "no time" in `isBlank` for clock fields and in `clockTime`. Checked in Phase 3: the worktime schema still defaults `clock_in`/`clock_out` to `"00:00"`, and the frontend's clock-in page still sends "no time" as `"00:00"` (`ClockInPage.tsx`, `entryToPayload`). So a real midnight time can't be told from "not clocked" anywhere; fixing it means storing `""`/`null` for "no time" in the schema, the clock-in page and the reports together.
- **Status:** Open

### BUG-004: The activity and error logs filter days in UTC, so in Algeria 00:00–00:59 lands on the day before
- **Severity:** Low
- **Type:** Bug (time zone)
- **Location:** `src/audit/audit.service.ts` `find` and `src/error-logs/error-log.service.ts` `find` (`` new Date(`${query.from}T00:00:00.000Z`) ``)
- **Found by:** `logs.e2e-spec.ts` › "filters days in the company's time zone"
- **Steps / input:** Something is changed at 00:30 on 20 October in Algeria (19 Oct 23:30 UTC). Open the activity log for 20 October.
- **Expected:** The change is listed under 20 October.
- **Actual:** It is listed under 19 October, and 21 October 00:00–00:59 shows up under the 20th. The filter uses UTC days; the company works in UTC+1 (`settings.utcOffset`).
- **Suggested fix:** Build the range from the company's `utcOffset` (`2026-10-20T00:00:00+01:00`), as `audit-changes.ts` already does to show dates. The super admin's error log without a company can stay in UTC.
- **Status:** Open

### BUG-005: A change the database refuses is logged as a 500, with Mongoose's raw text
- **Severity:** Low
- **Type:** Bug
- **Location:** `src/audit/audit.interceptor.ts`, error handler (`err instanceof HttpException ? err.getStatus() : 500`)
- **Found by:** `logs.e2e-spec.ts` › "logs the refused employee … with the status the user saw (400)" / "(409)"
- **Steps / input:** Add an employee without a name (400 for the user), or with an employee number already used (409).
- **Expected:** The activity log shows the failed action with 400 / 409 and the message the user saw ("First name is required", "The employee number "6" is already used").
- **Actual:** Status 500 and "Employee validation failed: lastName: Path `lastName` is required., …" or "E11000 duplicate key error …". The interceptor sees the database error before `AllExceptionsFilter` turns it into a 400/409, so admins reading the log think the server crashed.
- **Suggested fix:** Share the translation: move `AllExceptionsFilter.translate` into a function both use, and log its status and message.
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
- **Access control holds.** All 84 routes were called without a login, as a kiosk account, as a manager,
  as an admin, by a company without the route's feature and by a super admin without a company: every
  refusal was the expected 401/403, and no allowed caller was refused. Allowed callers sending an empty
  body and ids that match nothing never crashed, except BUG-301. (The plan said 91 routes: 7 were in
  commented-out code.)
- Creating a user with an email used in *another* company answers "A user with this email already
  exists", so an admin can find out whether an email has an account elsewhere. It follows from emails
  being unique across companies (one sign-in page); worth knowing, not worth changing.
- Company logos may be SVG. That is safe while the frontend shows them with `<img>` (scripts in an SVG
  don't run there); it must never insert the SVG into the page as HTML.
- The `/device/*` routes (status, users, logs of the clocking machine) all use one `DEVICE_IP` from the
  environment, whichever company asks. Checked in Phase 5: confirmed, it is [BUG-501](findings/attendance.md#bug-501-every-company-reads-the-same-clocking-machine-so-one-company-gets-anothers-punches).
- A manager reading `GET /worktime` (used by the clock-in pages) gets every employee's penalty, bonus and
  consumption, other managers included; only `GET /worktime/report` hides other managers. The clock-in pages
  need everyone's times, but not their money fields.
- Deleting an employee leaves their planning, work time, advances, bonuses and linked user account in place
  (pointing at nothing). Reports and the planning have to cope with that.
- Work time is searched by day from the server's own midnight (`new Date('2026-10-20T00:00:00.000')`)
  while days are stored at UTC midnight. Right on a UTC server (Render) and in Algeria; it would miss
  records on a server west of UTC.
- `GET /` answers 404: `AppController` / `AppService` ("Hello World!") exist and have a unit test, but
  `AppModule` doesn't register them. If Render or an uptime check pings `/`, it gets a 404. Either
  register them (as a health check) or delete the two files and their test.

- `planning.controller.ts` `findAll` still has a debugging leftover: `console.error('💀💀💀 findAll error:', err)`
  before re-throwing. It bypasses the app logger and the error log; the error is already logged by the
  exception filter. Delete the try/catch.

## Fixed issues

## Coverage exclusions

| File / lines | Why |
|--------------|-----|
| `src/main.ts` | Starts a real server on a port and installs process-wide crash handlers. Everything it configures is in `app.setup.ts`, which the integration tests run |
| Left uncovered (not excluded) after Phase 6 | `source-maps.ts` (one `require` used only by `main.ts`), `sessions.service.ts` "Session already renewed" (needs two refreshes landing in the same millisecond), `companies.service.ts` re-throw of a non-duplicate database error, `users.service.ts` guards the guard never reaches. The remaining branches are mostly default arguments and `??` fallbacks TypeScript adds, and `audit-changes.ts` labels for fields no route sends |

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
  **Never run it (or `eslint --fix`) on `src/` during this work**: it reformats ~90 application files.
  It happened once in Phase 2; everything under `src/` was restored from git before committing.
- `jest.setSystemTime` (Jest 30) refuses a `Date` made after `useFakeTimers()`; `setNow()` takes
  milliseconds or an ISO string and converts before faking.
- The route list for the access tests is read from `AppModule`'s metadata when the file loads
  (`test/helpers/routes.ts`), because `it.each` needs it before the app starts.
- Once in Phase 3, one coverage run printed per-file numbers from before the phase (e.g. bonuses 58%)
  while its total matched the other runs; three later runs agreed exactly (75.76% lines). Not reproduced.
- `test/security.e2e-spec.ts` started its own MongoDB, which on a busy machine sometimes didn't start
  within 10 s (19 tests failing, about one coverage run in three). In Phase 4 it moved to the shared
  test MongoDB (its own database in it); `maxWorkers: '50%'` keeps the integration files from starving
  that MongoDB. 4 coverage runs in a row then passed with identical numbers.
- `test/helpers/files.ts` reads downloads back: `download()` keeps the answer as bytes, `excelRows()`
  opens an Excel file with exceljs, `pdfText()` pulls the text out of a pdfkit PDF (inflates its
  streams and decodes the hex strings), `pdfPages()` counts pages.

## Refactors made to enable testing
