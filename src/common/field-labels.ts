// Field names as people say them, for messages like "First name is required".
// The French and Arabic names are in messages.i18n.ts (FIELDS).
const FIELD_LABELS: Record<string, string> = {
  empNumber: 'employee number',
  emp_id: 'employee',
  empId: 'employee',
  taskId: 'task number',
  taskName: 'task name',
  firstName: 'first name',
  lastName: 'last name',
  baseSalary: 'base salary',
  phoneNumber: 'phone number',
  startTime: 'start time',
  endTime: 'end time',
  shiftId: 'shift',
  shift_id: 'shift',
  planDate: 'date',
  deviceLogId: 'device record',
  deviceUserId: 'device user',
  slug: 'sign-in link name',
  'devices.serial': 'device serial',
  email: 'email',
  jobTitle: 'job title',
  familyStatus: 'family status',
  birthDate: 'date of birth',
  hireDate: 'hire date',
  socialSecurityNumber: 'insurance number',
  declaredSalary: 'declared salary',
  personalImage: 'photo',
  clock_in: 'clock-in time',
  clock_out: 'clock-out time',
  work_hours: 'worked hours',
  late_minutes: 'late minutes',
  overtime_minutes: 'overtime minutes',
  consomation: 'consumption',
  absent_comment: 'absence reason',
  backup_emp_id: 'backup employee',
  backup_for_emp_id: 'replaced employee',
  backupEmpIds: 'backup employees',
  backupEmpId: 'backup employee',
  customStartTime: 'start time',
  customEndTime: 'end time',
};

export function label(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const last = field.split('.').pop() ?? field;
  return (
    FIELD_LABELS[last] ??
    last
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
  );
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
