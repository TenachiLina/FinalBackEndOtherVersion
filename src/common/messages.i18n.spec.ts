import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { pickLang, translateMessage } from './messages.i18n';

describe('pickLang', () => {
  it('reads the language the app sends, English otherwise', () => {
    expect(pickLang('fr')).toBe('fr');
    expect(pickLang('fr-FR,fr;q=0.9')).toBe('fr');
    expect(pickLang('AR')).toBe('ar');
    expect(pickLang('en-US')).toBe('en');
    expect(pickLang('de')).toBe('en');
    expect(pickLang(undefined)).toBe('en');
    expect(pickLang(['fr'])).toBe('fr');
  });
});

describe('translateMessage', () => {
  it('leaves English and non-text alone', () => {
    expect(translateMessage('Not logged in', 'en')).toBe('Not logged in');
    expect(translateMessage(undefined as any, 'fr')).toBeUndefined();
  });

  it('translates fixed messages', () => {
    expect(translateMessage('Not logged in', 'fr')).toBe(
      "Vous n'êtes pas connecté",
    );
    expect(translateMessage('Not logged in', 'ar')).toBe('لم تسجّل الدخول');
  });

  it('translates messages with a variable part, including the field name', () => {
    expect(translateMessage('First name is required', 'fr')).toBe(
      'Prénom : champ obligatoire',
    );
    expect(translateMessage('First name is required', 'ar')).toBe(
      'الاسم الشخصي مطلوب',
    );
    expect(
      translateMessage('The employee number "12" is already used', 'fr'),
    ).toBe("Numéro d'employé « 12 » est déjà utilisé");
    expect(translateMessage('This email is already used', 'ar')).toBe(
      'البريد الإلكتروني مستخدم بالفعل',
    );
    expect(translateMessage('Base salary is too small', 'fr')).toBe(
      'Salaire de base : valeur trop petite',
    );
    expect(translateMessage('Shift is too large', 'ar')).toBe(
      'الفترة: القيمة كبيرة جدًا',
    );
    expect(translateMessage('Role must be one of: admin, manager', 'fr')).toBe(
      "Le rôle doit être l'un de : admin, manager",
    );
    expect(
      translateMessage('Password must be at least 10 characters', 'ar'),
    ).toContain('10');
    expect(translateMessage('Ali is already clocked in', 'fr')).toBe(
      'Ali a déjà pointé son arrivée',
    );
    expect(
      translateMessage(
        'The "bonuses" feature is not enabled for this company',
        'fr',
      ),
    ).toBe("Cette fonctionnalité n'est pas activée pour cette entreprise");
  });

  it.each([
    'Ali is already clocked in',
    "Ali isn't clocked in yet",
    'The email "a@b.dz" is already used',
    'This email is already used',
    'First name is required',
    'Amount is too small',
    'Amount is too large',
    "Role has a value that isn't allowed",
    'Amount has an invalid value',
    'Hours per day must be between 0 and 24',
    'Title must be at most 60 characters',
    'Password must be at least 10 characters',
    'Role must be one of: admin',
    'Features must be from: planning',
    'The "advances" feature is not enabled for this company',
    'Advance 12 not found',
  ])('translates "%s" into both languages', (m) => {
    expect(translateMessage(m, 'fr')).not.toBe(m);
    expect(translateMessage(m, 'ar')).not.toBe(m);
  });

  it('keeps an unknown field name as it is', () => {
    expect(translateMessage('Colour code is required', 'fr')).toBe(
      'Colour code : champ obligatoire',
    );
  });

  it('falls back to English for a message it does not know', () => {
    expect(translateMessage('Something new', 'fr')).toBe('Something new');
  });
});

// Every fixed message the API can send must reach French and Arabic users in
// their language. Reads the source for `new XxxException('…')` and
// `new XxxException({ message: '…' })`.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

function thrownMessages(): string[] {
  const found = new Set<string>();
  const re =
    /new \w*Exception\(\s*(?:\{[^}]*?message:\s*)?(['"])((?:\\.|(?!\1)[^\\])+)\1/g;
  for (const file of sourceFiles(join(__dirname, '..'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) {
      found.add(m[2].replace(/\\(['"])/g, '$1'));
    }
  }
  return [...found].sort();
}

describe('error messages thrown by the API', () => {
  const messages = thrownMessages();

  it('are found in the source', () => {
    expect(messages.length).toBeGreaterThan(30);
  });

  it('all have a French and an Arabic translation', () => {
    const untranslated = messages.filter(
      (m) => translateMessage(m, 'fr') === m || translateMessage(m, 'ar') === m,
    );
    expect(untranslated).toEqual([]);
  });

  // Messages built with a variable part (template strings in the source)
  it.each([
    'Advance 64b7f0c2a1b2c3d4e5f60001 not found.',
    'Password must be at least 10 characters',
    'Role must be one of: admin, manager, employee',
    'Features must be from: planning, clockin',
    'Title must be at most 60 characters',
    'Hours per day must be between 0 and 24',
  ])('translates "%s"', (m) => {
    expect(translateMessage(m, 'fr')).not.toBe(m);
    expect(translateMessage(m, 'ar')).not.toBe(m);
  });

  // BUG-002: two messages with a variable part reach French and Arabic users in English
  it.failing.each([
    'An advance for employee 12 on 2026-10-20 already exists.',
    'Worktime with id 64b7f0c2a1b2c3d4e5f60001 not found',
  ])('translates "%s"', (m) => {
    expect(translateMessage(m, 'fr')).not.toBe(m);
    expect(translateMessage(m, 'ar')).not.toBe(m);
  });
});
