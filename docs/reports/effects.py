# Plain-language effect of each backend bug: who notices, and what goes wrong for the business.
EFFECTS = {
    # common, tenancy, audit
    "BUG-001": "No route reads data that deep today, so nothing can be abused now. But the injection check fails open: a future route that reads a deeply nested field would be unprotected.",
    "BUG-002": "French and Arabic users see two error messages in English (a duplicate advance, a work time record that no longer exists) and may not understand them.",
    "BUG-003": "In the activity log, a clock-out at exactly midnight reads \"Clock-out time: Changed\" with no time, so an admin checking a night shift can't see when the employee left.",
    "BUG-004": "When an admin filters the activity or error log by day, changes made between 00:00 and 00:59 appear under the day before, which confuses anyone investigating a night-time change.",
    "BUG-005": "Simple refusals (a missing name, an employee number already used) appear in the activity log as server crashes (500) with database jargon, so admins think the system broke.",
    # auth, users, companies
    "BUG-101": "On the \"your sessions\" list, a phone sign-in from Chrome, Firefox or Edge shows the wrong browser. Someone checking for a sign-in they don't recognise may raise a false alarm or miss a real one.",
    "BUG-102": "If two admins demote or deactivate each other at the same moment, the company has no admin left and needs the super admin to recover.",
    "BUG-103": "The super admin can't create two companies whose names give the same sign-in link name, and the message doesn't say what to change.",
    "BUG-104": "A company can't switch weekly advances off by setting the share to 0%, although the message says 0 is allowed.",
    # staff
    "BUG-201": "An edit can save an employee with an empty name. Payslips, plannings and reports then show a blank person.",
    "BUG-202": "Saving or deleting a record that no longer exists (deleted in another tab) looks successful, so the user believes a change was saved when nothing happened.",
    "BUG-203": "A manager can raise their own salary through the API, and payroll pays it. They can also delete their own employee record.",
    "BUG-204": "Deleting a shift that is still planned happens at once with no warning. Those planning entries point at nothing, show as an unknown shift and disappear from the exports.",
    "BUG-205": "An employee can be saved without an employee number. A second one is then refused with a confusing \"number already used\" message, and that employee can't be matched to clock-ins.",
    # planning
    "BUG-301": "A broken \"copy month\" request is logged as a server crash instead of being refused with a clear message.",
    "BUG-302": "A broken \"save day\" request from another client deletes the whole day's planning, then crashes. The app itself always sends the list, so normal users don't meet it.",
    "BUG-303": "Once an employee or shift used on a day is deleted, that day can no longer be imported into another day: the import fails every time.",
    "BUG-304": "Copying one month's planning onto another deletes every day of the target month, including weekdays it doesn't copy. Planning already made for those days is lost without warning.",
    "BUG-305": "When copying a month, \"the first Tuesday\" (or other weekday) can be taken from the wrong week, so the copied planning isn't the one the manager expected.",
    "BUG-306": "The planning exports (Excel and PDF) silently leave out everyone starting at 13:00, before 06:00 or in the evening; the manager week export has no evening service at all. Printed plannings are incomplete.",
    "BUG-307": "One sub-task without a start time makes the planning exports fail for that period.",
    # payroll
    "BUG-401": "A negative advance adds money to the payslip, and a 0 advance blocks the real advance for that date. Only the frontend prevents it today.",
    "BUG-402": "An advance or bonus can be recorded for an employee number that doesn't exist. The money appears on no payslip, and later lands on whoever gets that number.",
    "BUG-403": "Two work time records can be saved for the same employee, shift and day (two tabs, the kiosk and a manager, a double click). Payroll counts both, so the day is paid twice.",
    # attendance, kiosk, machines
    "BUG-501": "Every company with the clock-in feature reaches the one clocking machine in the server settings. Another company's Sync copies your employees' punches into their data, and they can read the names on your machine. This is the only place where companies' data is not kept apart.",
    "BUG-502": "After the clocking machine's memory is cleared, Sync says \"completed\" but skips every new punch until the machine's counter passes its old maximum. Those days' attendance is missing from history and payroll.",
    "BUG-503": "On Clock-in History, punches between 00:00 and 00:59 appear on the day before, so night-shift arrivals and departures look like they happened the previous day.",
    "BUG-504": "After a normal day (08:00–17:00), the kiosk refuses the employee's clock-in the next morning (\"already clocked in\") and shows them as clocked in all night. To clock in they must first press Clock out, which records a false punch and a false clock-out.",
    "BUG-505": "Overtime worked past midnight after an evening shift (for example 14:00–22:00, leaving at 01:00) is recorded as 0, so the employee isn't paid for it.",
}
