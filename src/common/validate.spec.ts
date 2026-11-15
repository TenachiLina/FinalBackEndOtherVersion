import { BadRequestException } from '@nestjs/common';
import { validateBody, type Rules } from './validate';
import {
  EMPLOYEE_FIELDS,
  PLANNING_FIELDS,
  SHIFT_FIELDS,
  TASK_FIELDS,
  WORKTIME_FIELDS,
} from './body-rules';
import { capitalize, label } from './field-labels';
import { translateMessage } from './messages.i18n';

/** The messages a body is refused with; [] when it is accepted. */
function problems(
  body: unknown,
  rules: Rules,
  mode: 'full' | 'partial' = 'full',
): string[] {
  try {
    validateBody(body, rules, mode);
    return [];
  } catch (err) {
    if (!(err instanceof BadRequestException)) throw err;
    const message = (err.getResponse() as { message: string | string[] })
      .message;
    return Array.isArray(message) ? message : [message];
  }
}

const RULES: Rules = {
  name: { kind: 'string', required: true, max: 5 },
  age: { kind: 'number', min: 0, max: 120 },
  count: { kind: 'integer' },
  on: { kind: 'boolean' },
  at: { kind: 'time' },
  day: { kind: 'day' },
  when: { kind: 'date' },
  tags: { kind: 'strings', max: 2 },
  items: { kind: 'objects', max: 2 },
  colour: { kind: 'string', oneOf: ['red', 'blue'] },
  note: { kind: 'string', allowEmpty: true, nullable: true },
};

describe('validateBody', () => {
  it('returns the listed fields, cleaned', () => {
    expect(
      validateBody(
        {
          name: '  Ali ',
          age: '42',
          count: 3,
          on: 'true',
          at: '08:30',
          day: '2026-11-14',
          when: '2026-11-14T10:00:00.000Z',
          tags: ['a'],
          items: [{ id: 1 }],
          colour: 'red',
          note: '',
        },
        RULES,
      ),
    ).toEqual({
      name: 'Ali',
      age: 42,
      count: 3,
      on: true,
      at: '08:30',
      day: '2026-11-14',
      when: '2026-11-14T10:00:00.000Z',
      tags: ['a'],
      items: [{ id: 1 }],
      colour: 'red',
      note: '',
    });
  });

  it('drops the fields that are not listed', () => {
    expect(
      validateBody(
        { name: 'Ali', role: 'admin', companyId: 'x', $where: '1' },
        RULES,
      ),
    ).toEqual({ name: 'Ali' });
  });

  it.each([null, undefined, 'text', 42, [], [{ name: 'Ali' }], new Date()])(
    'refuses a body that is not an object: %p',
    (body) => {
      expect(problems(body, RULES)).toEqual(['The data sent was not valid']);
    },
  );

  it('asks for a required field that is missing, empty or null', () => {
    for (const name of [undefined, '', '   ', null]) {
      expect(problems({ name }, RULES)).toEqual(['Name is required']);
    }
  });

  it('an update only checks what is sent, and still refuses an emptied required field', () => {
    expect(validateBody({ age: 30 }, RULES, 'partial')).toEqual({ age: 30 });
    expect(validateBody({}, RULES, 'partial')).toEqual({});
    expect(problems({ name: '' }, RULES, 'partial')).toEqual([
      'Name is required',
    ]);
    expect(problems({ name: null }, RULES, 'partial')).toEqual([
      'Name is required',
    ]);
  });

  it('leaves out an optional field sent empty, unless empty is a value', () => {
    expect(validateBody({ name: 'Ali', age: '', day: null }, RULES)).toEqual({
      name: 'Ali',
    });
    expect(validateBody({ name: 'Ali', note: '' }, RULES)).toEqual({
      name: 'Ali',
      note: '',
    });
    expect(validateBody({ name: 'Ali', note: null }, RULES)).toEqual({
      name: 'Ali',
      note: null,
    });
  });

  it.each([
    [{ name: 42 }, 'Name has an invalid value'],
    [{ name: 'Abdelkader' }, 'Name is too large'],
    [{ name: 'Ali', age: 'old' }, 'Age has an invalid value'],
    [{ name: 'Ali', age: -1 }, 'Age is too small'],
    [{ name: 'Ali', age: 121 }, 'Age is too large'],
    [{ name: 'Ali', age: Infinity }, 'Age has an invalid value'],
    [{ name: 'Ali', age: {} }, 'Age has an invalid value'],
    [{ name: 'Ali', count: 2.5 }, 'Count has an invalid value'],
    [{ name: 'Ali', on: 'yes' }, 'On has an invalid value'],
    [{ name: 'Ali', at: '25:00' }, 'At has an invalid value'],
    [{ name: 'Ali', at: '8h30' }, 'At has an invalid value'],
    [{ name: 'Ali', at: 830 }, 'At has an invalid value'],
    [{ name: 'Ali', day: '14/11/2026' }, 'Day has an invalid value'],
    [{ name: 'Ali', day: '2026-02-30' }, 'Day has an invalid value'],
    [{ name: 'Ali', when: 'yesterday' }, 'When has an invalid value'],
    [{ name: 'Ali', when: '2026-02-30' }, 'When has an invalid value'],
    [{ name: 'Ali', when: {} }, 'When has an invalid value'],
    [{ name: 'Ali', tags: 'a' }, 'Tags has an invalid value'],
    [{ name: 'Ali', tags: ['a', 1] }, 'Tags has an invalid value'],
    [{ name: 'Ali', tags: ['a', 'b', 'c'] }, 'Tags is too large'],
    [{ name: 'Ali', items: [1] }, 'Items has an invalid value'],
    [{ name: 'Ali', items: [{}, {}, {}] }, 'Items is too large'],
    [{ name: 'Ali', colour: 'green' }, "Colour has a value that isn't allowed"],
  ])('refuses %j', (body, message) => {
    expect(problems(body, RULES)).toEqual([message]);
  });

  it('accepts times with seconds, booleans as 0/1, and dates as timestamps', () => {
    expect(
      validateBody(
        { name: 'Ali', at: '23:59:59', on: 0, when: 1_800_000_000_000 },
        RULES,
      ),
    ).toEqual({
      name: 'Ali',
      at: '23:59:59',
      on: false,
      when: 1_800_000_000_000,
    });
    expect(validateBody({ name: 'Ali', on: 1 }, RULES)).toMatchObject({
      on: true,
    });
    expect(validateBody({ name: 'Ali', on: 'false' }, RULES)).toMatchObject({
      on: false,
    });
    expect(
      validateBody({ name: 'Ali', when: new Date(0) }, RULES),
    ).toMatchObject({ when: new Date(0) });
  });

  it('reports every wrong field at once', () => {
    expect(problems({ age: -1, at: 'noon' }, RULES)).toEqual([
      'Name is required',
      'Age is too small',
      'At has an invalid value',
    ]);
  });

  it('a number allowed from a list', () => {
    const rules: Rules = { level: { kind: 'integer', oneOf: [1, 2, 3] } };
    expect(validateBody({ level: '2' }, rules)).toEqual({ level: 2 });
    expect(problems({ level: 4 }, rules)).toEqual([
      "Level has a value that isn't allowed",
    ]);
  });

  it('a text can have a minimum length', () => {
    const rules: Rules = { code: { kind: 'string', min: 4 } };
    expect(problems({ code: 'abc' }, rules)).toEqual(['Code is too small']);
  });
});

describe('field names', () => {
  it('uses the names people say', () => {
    expect(label('empNumber')).toBe('employee number');
    expect(label('work_date')).toBe('work date');
    expect(label('devices.serial')).toBe('device serial');
    expect(label('settings.firstName')).toBe('first name');
    expect(label('someOther_field')).toBe('some other field');
    expect(capitalize('first name')).toBe('First name');
  });
});

describe('the rules of each record', () => {
  it('an employee needs a number and a name', () => {
    expect(problems({}, EMPLOYEE_FIELDS)).toEqual([
      'Employee number is required',
      'First name is required',
      'Last name is required',
    ]);
    expect(
      validateBody(
        {
          empNumber: '7',
          firstName: 'Ali',
          lastName: 'Zerrouki',
          baseSalary: '45000',
          familyStatus: 'M',
          birthDate: '2000-01-31',
          declaredSalary: null,
          insured: true,
          role: 'admin',
        },
        EMPLOYEE_FIELDS,
      ),
    ).toEqual({
      empNumber: 7,
      firstName: 'Ali',
      lastName: 'Zerrouki',
      baseSalary: 45000,
      familyStatus: 'M',
      birthDate: '2000-01-31',
      declaredSalary: null,
      insured: true,
    });
  });

  it.each([
    [{ empNumber: 0 }, 'Employee number is too small'],
    [{ empNumber: 1.5 }, 'Employee number has an invalid value'],
    [{ baseSalary: -1 }, 'Base salary is too small'],
    [{ baseSalary: 'a lot' }, 'Base salary has an invalid value'],
    [{ familyStatus: 'X' }, "Family status has a value that isn't allowed"],
    [{ birthDate: '31/01/2000' }, 'Date of birth has an invalid value'],
    [{ firstName: '' }, 'First name is required'],
    [{ declaredSalary: -5 }, 'Declared salary is too small'],
  ])('refuses the employee change %j', (body, message) => {
    expect(problems(body, EMPLOYEE_FIELDS, 'partial')).toEqual([message]);
  });

  it('an employee detail can be cleared', () => {
    expect(
      validateBody(
        { address: '', jobTitle: '', familyStatus: '', hireDate: '' },
        EMPLOYEE_FIELDS,
        'partial',
      ),
    ).toEqual({ address: '', jobTitle: '', familyStatus: '', hireDate: '' });
  });

  it('a shift needs two times', () => {
    expect(problems({ startTime: '8' }, SHIFT_FIELDS)).toEqual([
      'Start time has an invalid value',
      'End time is required',
    ]);
    expect(
      validateBody({ startTime: '08:00', endTime: '16:00' }, SHIFT_FIELDS),
    ).toEqual({ startTime: '08:00', endTime: '16:00' });
  });

  it('a post needs a number and a name', () => {
    expect(problems({ taskName: 'Grill' }, TASK_FIELDS)).toEqual([
      'Task number is required',
    ]);
    expect(problems({ taskId: 'one', taskName: 'Grill' }, TASK_FIELDS)).toEqual(
      ['Task number has an invalid value'],
    );
  });

  it('work time: an empty clock time means "not clocked", money is never negative', () => {
    expect(
      validateBody(
        { emp_id: 1, clock_in: '08:00', clock_out: '', penalty: '50' },
        WORKTIME_FIELDS,
      ),
    ).toEqual({ emp_id: 1, clock_in: '08:00', clock_out: '', penalty: 50 });
    expect(
      validateBody({ clock_out: null }, WORKTIME_FIELDS, 'partial'),
    ).toEqual({ clock_out: null });
    expect(
      problems(
        { emp_id: 1, penalty: -1, consomation: -2, clock_in: '8am' },
        WORKTIME_FIELDS,
      ),
    ).toEqual([
      'Clock-in time has an invalid value',
      'Consumption is too small',
      'Penalty is too small',
    ]);
    expect(problems({}, WORKTIME_FIELDS)).toEqual(['Employee is required']);
  });

  it('a planning entry needs a shift, an employee, a post and a day', () => {
    expect(problems({}, PLANNING_FIELDS)).toEqual([
      'Shift is required',
      'Employee is required',
      'Task number is required',
      'Date is required',
    ]);
    expect(
      problems({ backupEmpIds: 'e2' }, PLANNING_FIELDS, 'partial'),
    ).toEqual(['Backup employees has an invalid value']);
  });
});

describe('the messages reach French and Arabic users in their language', () => {
  const samples = [
    ...problems({}, EMPLOYEE_FIELDS),
    ...problems(
      {
        empNumber: 0,
        baseSalary: 'x',
        familyStatus: 'X',
        birthDate: 'x',
        hireDate: 'x',
        declaredSalary: -1,
        jobTitle: 'j'.repeat(81),
        socialSecurityNumber: 's'.repeat(41),
        phoneNumber: 'p'.repeat(41),
        address: 'a'.repeat(201),
        insured: 'maybe',
      },
      EMPLOYEE_FIELDS,
      'partial',
    ),
    ...problems({}, SHIFT_FIELDS),
    ...problems({}, TASK_FIELDS),
    ...problems({}, PLANNING_FIELDS),
    ...problems(
      {
        emp_id: 'x',
        clock_in: 'x',
        clock_out: 'x',
        late_minutes: -1,
        overtime_minutes: -1,
        consomation: -1,
        penalty: -1,
        bonus: -1,
        absent: 'x',
        absent_comment: 'c'.repeat(301),
        work_hours: 'w'.repeat(13),
        work_date: 'x',
        backup_emp_id: 0,
        backup_for_emp_id: 0,
      },
      WORKTIME_FIELDS,
      'partial',
    ),
    ...problems(
      {
        backupEmpIds: 1,
        backupEmpId: 1,
        tasks: 1,
        customStartTime: 'x',
        customEndTime: 'x',
      },
      PLANNING_FIELDS,
      'partial',
    ),
  ];

  it('covers a wide set of messages', () => {
    expect(samples.length).toBeGreaterThan(35);
  });

  // Words that are the same in French ("date", "photo")
  const SAME_IN_FRENCH = ['Date', 'Photo'];

  it.each(['fr', 'ar'] as const)('all are translated into %s', (lang) => {
    const english = samples.filter((m) => {
      const translated = translateMessage(m, lang);
      // The field name itself must be translated too, not only the sentence
      const field = m.replace(
        / (is required|is too small|is too large|has an invalid value|has a value that isn't allowed)$/,
        '',
      );
      const nameKept =
        translated.includes(field) &&
        !(lang === 'fr' && SAME_IN_FRENCH.includes(field));
      return translated === m || nameKept;
    });
    expect(english).toEqual([]);
  });

  it('for example', () => {
    expect(translateMessage('Date of birth has an invalid value', 'fr')).toBe(
      'Date de naissance : valeur invalide',
    );
    expect(translateMessage('Insurance number is too large', 'ar')).toBe(
      'رقم التأمين: القيمة كبيرة جدًا',
    );
  });
});
