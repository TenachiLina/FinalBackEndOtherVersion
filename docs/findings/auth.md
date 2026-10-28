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

## Observations (not bugs, to confirm)

## Fixed issues
