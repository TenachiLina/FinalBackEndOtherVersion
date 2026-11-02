# Test findings: auth, users, sessions, companies and access control

Bugs found while testing `src/auth/*`, `src/companies/*` and the role/company checks on every route.
Each bug has a test marked `it.failing(...)` with a `// BUG-1NN` comment above it. The test describes the
**correct** behaviour and currently fails. Entry format: see [../TEST_FINDINGS.md](../TEST_FINDINGS.md).

## Open issues

Sorted by severity.

### BUG-101: Chrome, Firefox and Edge on phones are listed as another browser
- **Severity:** Low
- **Type:** Bug
- **Location:** `src/auth/device.ts`, `describeDevice`
- **Found by:** `device.spec.ts` › "… CriOS … → Chrome on iOS", "… FxiOS … → Firefox on iOS", "… EdgA … → Edge on Android"
- **Steps / input:** Sign in from Chrome or Firefox on an iPhone, or from Edge on Android, then open the list of login sessions.
- **Expected:** "Chrome on iOS", "Firefox on iOS", "Edge on Android".
- **Actual:** "Safari on iOS", "Safari on iOS" and "Chrome on Android". On iPhone these browsers say `CriOS/` and `FxiOS/` instead of `Chrome/` and `Firefox/`, and Edge on Android says `EdgA/` instead of `Edg/`. Someone checking for a sign-in they don't recognise sees the wrong browser.
- **Suggested fix:** Match `/Edg(A|iOS)?//`, `/Chrome/|CriOS//` and `/Firefox/|FxiOS//`.
- **Status:** Open

### BUG-102: Two admins demoting each other at the same moment leave the company with no admin
- **Severity:** Low
- **Type:** Bug (race condition)
- **Location:** `src/auth/users.service.ts`, `update` → `ensureAnotherActiveAdmin`
- **Found by:** `users.e2e-spec.ts` › "keeps one active admin when two admins demote each other at once"
- **Steps / input:** A company has exactly two admins, A and B. At the same moment A changes B to manager and B changes A to manager (two `PATCH /users/:id`).
- **Expected:** One of the two is refused ("The company must keep at least one active admin").
- **Actual:** Both succeed: each request counts the *other* admin as still active before either is saved. The company has no admin left, and only the super admin can fix it. Deactivating or deleting at the same moment has the same gap.
- **Suggested fix:** Make the check and the change one step: after saving, count active admins and undo if there are none, or run both in a MongoDB transaction.
- **Status:** Open

### BUG-103: A second company whose name gives the same sign-in link name can't be created
- **Severity:** Low
- **Type:** Bug
- **Location:** `src/companies/companies.service.ts`, `apply` (`company.slug = slugify(company.name)`) and `save`
- **Found by:** `companies.e2e-spec.ts` › "creates a second company with the same name"
- **Steps / input:** Super admin creates "Pizza Roma", then "Pizza  Roma!" (or a second "Pizza Roma" in another city), without typing a sign-in link name.
- **Expected:** The second company is created with its own link name (e.g. `pizza-roma-2`).
- **Actual:** 409 "That sign-in link name or one of the device serials is already used by another company". The super admin typed neither, so the message doesn't say what to change.
- **Suggested fix:** When the link name comes from the company name, add `-2`, `-3`… until it is free. Keep the 409 for a link name the super admin typed.
- **Status:** Open

### BUG-104: A weekly advance share of 0% is refused, with a message saying 0 is allowed
- **Severity:** Low
- **Type:** Bug
- **Location:** `src/companies/companies.service.ts`, `validateSettings` (`positive(…)` refuses `n <= 0`)
- **Found by:** `companies.e2e-spec.ts` › "accepts a weekly advance share of 0 (no weekly advances)"
- **Steps / input:** Company settings → weekly advance share 0% (a company that doesn't give weekly advances): `PATCH /company` with `{ settings: { weeklyAdvanceRatio: 0 } }`.
- **Expected:** Saved. The frontend accepts 0 (its BUG-002 fix "accept a weekly advance ratio of 0").
- **Actual:** 400 "Weekly advance ratio must be between 0 and 1": the message says 0 is allowed, but the check refuses it. Hours per day and working days per month use the same wording, though 0 really makes no sense there.
- **Suggested fix:** Allow 0 for `weeklyAdvanceRatio` (refuse only `n < 0`); for the other two, say "must be more than 0 and at most …".
- **Status:** Open

## Observations (not bugs, to confirm)

## Fixed issues
