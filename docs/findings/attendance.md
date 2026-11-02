# Test findings: attendance, kiosk and devices

Bugs found while testing `src/attendance/*`, `src/zkteco/*` and `src/attendance-device/*`.
Each bug has a test marked `it.failing(...)` with a `// BUG-5NN` comment above it. The test describes the
**correct** behaviour and currently fails. Entry format: see [../TEST_FINDINGS.md](../TEST_FINDINGS.md).

## Open issues

Sorted by severity.

### BUG-501: Every company reads the same clocking machine, so one company gets another's punches
- **Severity:** High
- **Type:** Security (data of another company)
- **Location:** `src/attendance-device/attendance-device.service.ts`, `connect` (`new ZKLib(process.env.DEVICE_IP, …)`); used by `POST /attendance/sync` and `GET /device/{ping,status,users,logs}`
- **Found by:** `attendance.e2e-spec.ts` › "a company's sync never brings in punches from another company's machine", "a company can't read the user list and punches of another company's machine"
- **Steps / input:** Company A owns the face-recognition machine at `DEVICE_IP`. An admin or manager of company B (any company with the clock-in feature) opens Clock-in History and presses Sync, or calls `GET /device/users` / `GET /device/logs`.
- **Expected:** Company B only reaches a machine registered to company B; with none, it gets nothing (or "no machine configured").
- **Actual:** Every company talks to the one machine in `DEVICE_IP`. B's sync copies A's punches into B's attendance (where they match B's employee numbers, they count as B's employees' punches); `/device/users` returns the names on A's machine, `/device/logs` all A's punches, and `/device/status` the machine's IP. Everything else in the app is strictly separated by company; this is the one hole.
- **Suggested fix:** Store each machine's address on the company (as `devices[].serial` already is for the ZKTeco push) and connect to the current company's machine; refuse when it has none. Until then, allow these routes only to the company that owns the machine.
- **Status:** Open

### BUG-502: After the machine's log is cleared, its new punches are dropped without a word
- **Severity:** Medium
- **Type:** Data loss
- **Location:** `src/attendance/attendance.service.ts`, `syncLogs` (`deviceLogId = String(log.userSn)`, then `findOne({ deviceLogId })`)
- **Found by:** `attendance.e2e-spec.ts` › "still saves new punches after the machine's log was cleared", "saves punches the machine sent without a record number"
- **Steps / input:** Sync the machine (punches numbered 1, 2, …). Clear its attendance log (done when its memory fills up); the numbering starts again at 1. Employees clock in; sync again.
- **Expected:** The new punches are saved.
- **Actual:** Punches are recognised only by the machine's record number (`userSn`), so every new punch whose number was already seen is taken for a duplicate and skipped, until the count passes the old highest number. Sync still says "Sync completed". Also, a punch without a number is saved as `"undefined"` (`String(undefined)` passes the `!deviceLogId` check), and every later one without a number is dropped.
- **Suggested fix:** Recognise a punch by employee + time (`deviceUserId` + `recordTime`), as the ZKTeco receiver does with its line hash; skip (and count) entries without them.
- **Status:** Open

### BUG-504: After a normal day, the kiosk thinks the employee is still clocked in the next morning
- **Severity:** Medium
- **Type:** Bug
- **Location:** `src/attendance/kiosk.controller.ts`, `recentPunches` + `stateOf` (punches of the last 16 hours, odd count = clocked in)
- **Found by:** `kiosk.e2e-spec.ts` › "lets someone who worked 08:00–17:00 yesterday clock in at 08:00 today", "shows someone who clocked out at 17:00 as not clocked in after midnight"
- **Steps / input:** Clock in at 08:00 and out at 17:00 on the kiosk. Next morning at 08:00, clock in again.
- **Expected:** 201, clocked in.
- **Actual:** 409 "Ali Ben is already clocked in". At 08:00 the 16-hour window starts at 16:00 the day before: it holds the 17:00 clock-out but no longer the 08:00 clock-in, so one punch is counted, which reads as "clocked in". From 00:00 (16 h after 08:00) to 09:00 (16 h after 17:00) the kiosk lists the employee as clocked in since 17:00. Anyone whose rest between two shifts is under 16 hours meets it; to clock in, they have to press Clock out first, which saves a false punch and a false clock-out.
- **Suggested fix:** Decide from the last punch, not the count: clocked in if the most recent punch within the window is a clock-in. That needs the direction stored on each punch (kiosk punches know it; machine punches have a status code), or counting from the first punch of the employee's current session instead of a fixed window.
- **Status:** Open

### BUG-505: Overtime after midnight is lost unless the shift ends at exactly 00:00
- **Severity:** Medium
- **Type:** Bug (pay)
- **Location:** `src/attendance/kiosk.controller.ts`, `saveWorktime` (`if (end === 1440 && out < 720) out += 1440`)
- **Found by:** `kiosk.e2e-spec.ts` › "counts overtime past midnight after an evening shift ending at 22:00"
- **Steps / input:** Shift 14:00–22:00. The employee clocks in at 14:00 and out at 01:00 the next night.
- **Expected:** Worked 11:00, overtime 180 minutes.
- **Actual:** Worked 11:00 (right) but overtime 0: the clock-out (60) is compared with the shift end (1320) without moving it past midnight. Only a shift ending at 00:00 gets that treatment. Worked hours already handle midnight (`if (worked < 0) worked += 1440`).
- **Suggested fix:** Move the clock-out past midnight whenever it is earlier than the clock-in (as for worked hours), and the shift end whenever it is earlier than the shift start; then compare.
- **Status:** Open

### BUG-503: Clock-in History cuts days at UTC midnight, so in Algeria 00:00–00:59 lands on the day before
- **Severity:** Low
- **Type:** Bug (time zone)
- **Location:** `src/attendance/attendance.service.ts`, `getLogsByDateRange` (`` new Date(`${from}T00:00:00.000Z`) ``)
- **Found by:** `attendance.e2e-spec.ts` › "lists a punch at 00:30 in Algeria under that day"
- **Steps / input:** Someone clocks in at 00:30 on 20 October in Algeria (19 Oct 23:30 UTC). Open Clock-in History for 20 October (`GET /attendance/device-logs?from=2026-10-20&to=2026-10-20`).
- **Expected:** The punch is listed under 20 October.
- **Actual:** It is listed under 19 October. The range is built in UTC; the company works in UTC+1 (`settings.utcOffset`). Night shifts punch in that hour.
- **Suggested fix:** Same as BUG-004: build the range from the company's offset (`2026-10-20T00:00:00+01:00`).
- **Status:** Open

## Observations (not bugs, to confirm)

- The attendance routes answer **200/201 with `{ status: 'error', message }`** for a machine that can't be
  reached and for refused input (`POST /attendance/device-logs` without an employee or with a bad time). The
  frontend and the activity log (`audit.interceptor`) rely on that, so it is a convention, but a client that
  checks the HTTP status sees success. `PATCH` / `DELETE` on the same routes answer 400/404.
- **ZKTeco push (`/iclock`)**: one malformed line makes the whole upload answer `500 ERROR` (by design, so the
  machine retries). The good lines are saved, but if a line is permanently malformed the machine resends
  that batch forever and never moves on. Worth watching in the Render logs once the machine is live.
- Punches pushed by the ZKTeco machine are stored in `zkteco_attendance_events` with
  `processingStatus: 'pending'` and nothing reads them yet: they don't appear in Clock-in History, the
  kiosk or work time. `src/zkteco/README.md` says this is intended for now. The README is out of date: it
  talks about `ZKTECO_DEVICE_SERIAL` / `ZKTECO_UTC_OFFSET` env vars, but the serial is now read from the
  company's devices and the offset from `settings.utcOffset`.
- The kiosk's work time record is "first clock-in, last clock-out": in 08:00, out 12:00, in 13:00, out 17:00
  gives 09:00 worked, the lunch break included (test "keeps the first clock-in and the last clock-out of the
  day"). It matches the comment and the manager's page; confirm it is what payroll wants.
- `AttendanceDeviceService` keeps the connection in one field shared by all requests: two syncs at the same
  moment replace each other's connection. If reading users or punches fails after connecting, it never
  disconnects.
- `AttendanceService.getDeviceLogs(date)` isn't used by any route (the controller uses
  `getLogsByDateRange`). Tested directly; can be deleted.

## Fixed issues
