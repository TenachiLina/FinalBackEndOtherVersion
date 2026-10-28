# Test findings: planning

Bugs found while testing `src/planning/*`: CRUD, bulk save, copying days and weeks, import, Excel and PDF exports.
Each bug has a test marked `it.failing(...)` with a `// BUG-3NN` comment above it. The test describes the
**correct** behaviour and currently fails. Entry format: see [../TEST_FINDINGS.md](../TEST_FINDINGS.md).

## Open issues

Sorted by severity.

### BUG-306: The exports leave out shifts starting at 13:00, before 06:00 and in the evening
- **Severity:** Medium
- **Type:** Bug (missing data)
- **Location:** `src/planning/planning.service.ts`: the fixed `hours` lists in `buildFirstWeekPlanningWithBackup`, `buildFirstWeekPlanningWithoutBackups` and `buildDayPlanning`
- **Found by:** `planning.e2e-spec.ts` › "… includes a shift starting at 13:00" (and 22:00, 18:00, 00:00)
- **Steps / input:** Plan someone on a shift starting at 13:00, 18:00, 22:00 or 00:00, then export the first week or the day (Excel or PDF).
- **Expected:** Everyone planned that day is in the export, under their start hour.
- **Actual:** Each export only has rows for a fixed list of hours, and anyone starting at another hour is silently dropped (`if (weekGrid[day][hour])`). None of the three has 13H or 22H–05H; the manager week export (with backups) stops at **16H**, so its whole evening service (17:00–21:00) is missing. The three lists were copied and changed separately.
- **Suggested fix:** Build the hour rows from the start hours actually present (sorted), instead of a fixed list; share one grid builder between the three exports.
- **Status:** Open

### BUG-303: Importing a day crashes when one of its employees or shifts was deleted
- **Severity:** Medium
- **Type:** Bug (crash)
- **Location:** `src/planning/planning.service.ts`, `importFromDate` (`item.empId._id`, `item.shiftId._id`)
- **Found by:** `planning.e2e-spec.ts` › "skips entries whose employee or shift was deleted"
- **Steps / input:** Plan Ali on a day, delete Ali (or delete the shift: BUG-204 makes that one easy), then import that day into another day in New planning.
- **Expected:** The import works and leaves out the entries that point at nothing (as the exports already do).
- **Actual:** 500 "Something went wrong": `Cannot read properties of null (reading '_id')`. The whole day can no longer be imported.
- **Suggested fix:** Skip entries whose populated `empId` or `shiftId` is null, like the export builders do.
- **Status:** Open

### BUG-304: Copying a month deletes the whole destination month, also the weekdays it doesn't copy
- **Severity:** Medium
- **Type:** Data loss
- **Location:** `src/planning/planning.service.ts`, `copyMonth` (`deleteMany` over the whole destination month)
- **Found by:** `planning.e2e-spec.ts` › "keeps the destination days of weekdays the source month has no planning for"
- **Steps / input:** September has planning only on Tuesdays. November already has a Thursday planned. Copy September → November.
- **Expected:** November's Tuesdays get September's Tuesday; its Thursday stays (or the user is told the whole month will be replaced).
- **Actual:** Every day of November is deleted first, then only the Tuesdays are filled: the Thursday is gone. The copy dialog only says "Copy and save the planning from one month to another month."
- **Suggested fix:** Delete only the destination days that receive a copy (the weekdays found in the source), or ask the frontend to warn that the month is replaced.
- **Status:** Open

### BUG-301: Copying a month without the months crashes with a 500
- **Severity:** Low
- **Type:** Bug
- **Location:** `src/planning/planning.controller.ts` `copyMonth` → `src/planning/planning.service.ts` `copyMonth` (`sourceMonth.split("-")`)
- **Found by:** `access.e2e-spec.ts` › "POST /planning/copy-month as admin"
- **Steps / input:** `POST /planning/copy-month` with `{}`, or with a value that isn't a month.
- **Expected:** 400 with a plain message ("Choose the month to copy and the month to copy to").
- **Actual:** 500 "Something went wrong on our side": `undefined.split` throws a TypeError, which is saved to the error log as a crash.
- **Suggested fix:** Check both values with `/^\d{4}-(0[1-9]|1[0-2])$/` before anything else.
- **Also:** a month that doesn't exist (`"2026-13"`) doesn't crash but is read as January of the next year (`planning.e2e-spec.ts` › "refuses a month that does not exist").
- **Status:** Open

### BUG-302: Saving a day without the list of entries empties the day, then crashes
- **Severity:** Low
- **Type:** Bug (crash, data loss)
- **Location:** `src/planning/planning.service.ts`, `replaceDay` (`deleteMany` runs before `entries.filter`)
- **Found by:** `planning.e2e-spec.ts` › "refuses a save without entries, and keeps the day"
- **Steps / input:** `POST /planning/bulk` with `{ "planDate": "2026-10-20" }` (no `entries`).
- **Expected:** 400, and the day is unchanged.
- **Actual:** The day's planning is deleted, then `entries.filter` throws: 500. The app always sends `entries`, so only another client or a broken request hits it.
- **Suggested fix:** Check `Array.isArray(entries)` and a valid `planDate` before deleting anything.
- **Status:** Open

### BUG-305: "The first Tuesday" of a copied month is the Tuesday saved first, not the earliest one
- **Severity:** Low
- **Type:** Bug
- **Location:** `src/planning/planning.service.ts`, `copyMonth` (source planning read without sorting)
- **Found by:** `planning.e2e-spec.ts` › "uses the earliest day of each weekday, whatever order the days were saved in"
- **Steps / input:** In September, save Tuesday the 8th, then Tuesday the 1st. Copy September → November.
- **Expected:** November's Tuesdays get the planning of Tuesday 1 September (the code comments say "the first occurrence").
- **Actual:** They get Tuesday the 8th, because that was saved first and the source planning isn't sorted by date.
- **Suggested fix:** `.sort({ planDate: 1 })` on the source query.
- **Status:** Open

### BUG-307: A sub-task without a start time makes the exports crash
- **Severity:** Low
- **Type:** Bug (crash)
- **Location:** `src/planning/planning.service.ts`, the three grid builders (`item.tasks[0].startTime.substring(0, 2)`)
- **Found by:** `planning.e2e-spec.ts` › "exports a day whose first sub-task has no time"
- **Steps / input:** Plan someone with a sub-task that has a label but no times, then export that day.
- **Expected:** The export uses the shift's start time.
- **Actual:** 500: `Cannot read properties of undefined (reading 'substring')`. Sub-task times are optional in the schema.
- **Suggested fix:** Use `item.tasks?.[0]?.startTime || item.shiftId.startTime`.
- **Status:** Open

## Observations (not bugs, to confirm)

- The three exports (week, week with backups, day), each in Excel and PDF, are six near-copies of
  the same code (~1,800 lines). BUG-306 and BUG-307 come from that: a fix in one copy doesn't reach the
  others. One grid builder and one Excel/PDF writer would remove most of the file.
- The planning controller and service print debug lines to the server console on every export
  (`":) ;)Exporting first week as PDF"`, the week's dates, `"💀💀💀 findAll error"`).
- A single hour with very many people (40 with two backups each) is taller than a PDF page; the
  export goes on to more pages and every name is in the file, but the table is split oddly. Checked
  only for "nothing is lost", not for looks.
- Saving a day uses an in-memory queue so two saves of the same day run one after the other. That works
  with one server process; with several instances (scaling on Render) two saves could still interleave.

## Fixed issues
