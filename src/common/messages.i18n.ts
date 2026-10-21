/**
 * Translations of the API's error messages (English is the source).
 * The app sends Accept-Language: en | fr | ar; AllExceptionsFilter uses
 * translateMessage() so every error reaches the user in their language.
 */

export type ApiLang = 'en' | 'fr' | 'ar';
type Tr = { fr: string; ar: string };

export function pickLang(header: unknown): ApiLang {
  const value = String(header ?? '').toLowerCase();
  if (value.startsWith('fr')) return 'fr';
  if (value.startsWith('ar')) return 'ar';
  return 'en';
}

const EXACT: Record<string, Tr> = {
  // auth
  'Invalid email or password': {
    fr: 'E-mail ou mot de passe incorrect',
    ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  },
  'Too many failed attempts. Try again in a few minutes.': {
    fr: 'Trop de tentatives échouées. Réessayez dans quelques minutes.',
    ar: 'محاولات فاشلة كثيرة. حاول مرة أخرى بعد بضع دقائق.',
  },
  'This company account is suspended': {
    fr: 'Le compte de cette entreprise est suspendu',
    ar: 'حساب هذه الشركة معلّق',
  },
  'Current password is incorrect': {
    fr: 'Le mot de passe actuel est incorrect',
    ar: 'كلمة المرور الحالية غير صحيحة',
  },
  'Not logged in': { fr: "Vous n'êtes pas connecté", ar: 'لم تسجّل الدخول' },
  'Session expired, please log in again': {
    fr: 'Session expirée, veuillez vous reconnecter',
    ar: 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا',
  },
  'Account is disabled': {
    fr: 'Ce compte est désactivé',
    ar: 'هذا الحساب معطّل',
  },
  'Your account has no company': {
    fr: "Votre compte n'est rattaché à aucune entreprise",
    ar: 'حسابك غير مرتبط بأي شركة',
  },
  'Company not found': {
    fr: 'Entreprise introuvable',
    ar: 'الشركة غير موجودة',
  },
  'This account can only clock employees in and out': {
    fr: 'Ce compte peut seulement pointer les arrivées et départs',
    ar: 'هذا الحساب مخصص لتسجيل الحضور والانصراف فقط',
  },
  'Choose a company first': {
    fr: "Choisissez d'abord une entreprise",
    ar: 'اختر شركة أولًا',
  },
  'You do not have permission to do this': {
    fr: "Vous n'avez pas l'autorisation de faire cela",
    ar: 'ليست لديك صلاحية للقيام بذلك',
  },
  // users
  'A valid email is required': {
    fr: 'Une adresse e-mail valide est requise',
    ar: 'يلزم بريد إلكتروني صالح',
  },
  'Name is required': { fr: 'Le nom est obligatoire', ar: 'الاسم مطلوب' },
  'A user with this email already exists': {
    fr: 'Un utilisateur avec cet e-mail existe déjà',
    ar: 'يوجد مستخدم بهذا البريد الإلكتروني بالفعل',
  },
  'User not found': { fr: 'Utilisateur introuvable', ar: 'المستخدم غير موجود' },
  'This employee is already linked to another user': {
    fr: 'Cet employé est déjà lié à un autre utilisateur',
    ar: 'هذا الموظف مرتبط بالفعل بمستخدم آخر',
  },
  "You can't see or change another manager's information": {
    fr: "Vous ne pouvez pas voir ni modifier les informations d'un autre responsable",
    ar: 'لا يمكنك رؤية معلومات مسؤول آخر أو تعديلها',
  },
  'You cannot remove your own admin access': {
    fr: 'Vous ne pouvez pas retirer votre propre accès administrateur',
    ar: 'لا يمكنك إزالة صلاحية المدير الخاصة بك',
  },
  'You cannot delete your own account': {
    fr: 'Vous ne pouvez pas supprimer votre propre compte',
    ar: 'لا يمكنك حذف حسابك',
  },
  'The company must keep at least one active admin': {
    fr: "L'entreprise doit garder au moins un administrateur actif",
    ar: 'يجب أن تحتفظ الشركة بمدير نشط واحد على الأقل',
  },
  // companies
  'Company name is required': {
    fr: "Le nom de l'entreprise est obligatoire",
    ar: 'اسم الشركة مطلوب',
  },
  'Sign-in link name: lowercase letters, numbers and dashes only': {
    fr: 'Nom du lien de connexion : lettres minuscules, chiffres et tirets uniquement',
    ar: 'اسم رابط الدخول: أحرف لاتينية صغيرة وأرقام وشرطات فقط',
  },
  'Devices must be a list': {
    fr: 'Les appareils doivent être une liste',
    ar: 'يجب أن تكون الأجهزة قائمة',
  },
  'Each device serial can be listed once': {
    fr: "Chaque numéro de série ne peut apparaître qu'une fois",
    ar: 'لا يمكن ذكر الرقم التسلسلي للجهاز إلا مرة واحدة',
  },
  'Logo must be a PNG, JPEG, WebP or SVG image under 300 KB': {
    fr: 'Le logo doit être une image PNG, JPEG, WebP ou SVG de moins de 300 Ko',
    ar: 'يجب أن يكون الشعار صورة PNG أو JPEG أو WebP أو SVG أقل من 300 كيلوبايت',
  },
  'Colour must look like #1E40AF': {
    fr: 'La couleur doit ressembler à #1E40AF',
    ar: 'يجب أن يكون اللون بصيغة ‎#1E40AF',
  },
  'Currency must be 1 to 8 characters': {
    fr: 'La devise doit faire de 1 à 8 caractères',
    ar: 'يجب أن تتكون العملة من 1 إلى 8 أحرف',
  },
  'UTC offset must look like +01:00': {
    fr: 'Le décalage UTC doit ressembler à +01:00',
    ar: 'يجب أن يكون فارق التوقيت بصيغة ‎+01:00',
  },
  'That sign-in link name or one of the device serials is already used by another company':
    {
      fr: "Ce nom de lien ou l'un des numéros de série est déjà utilisé par une autre entreprise",
      ar: 'اسم الرابط هذا أو أحد الأرقام التسلسلية مستخدم بالفعل من شركة أخرى',
    },
  'Language must be en, fr or ar': {
    fr: 'La langue doit être en, fr ou ar',
    ar: 'يجب أن تكون اللغة en أو fr أو ar',
  },
  // employees, attendance, kiosk
  'Employee not found': { fr: 'Employé introuvable', ar: 'الموظف غير موجود' },
  'Choose Clock in or Clock out': {
    fr: 'Choisissez Arrivée ou Départ',
    ar: 'اختر الحضور أو الانصراف',
  },
  'Invalid attendance log ID': {
    fr: 'Identifiant de pointage invalide',
    ar: 'معرّف تسجيل الحضور غير صالح',
  },
  'Attendance log not found': {
    fr: 'Pointage introuvable',
    ar: 'تسجيل الحضور غير موجود',
  },
  'Invalid timestamp': {
    fr: 'Date et heure invalides',
    ar: 'التاريخ والوقت غير صالحين',
  },
  'Shift not found': { fr: 'Créneau introuvable', ar: 'الفترة غير موجودة' },
  'Bonus not found': { fr: 'Prime introuvable', ar: 'المكافأة غير موجودة' },
  'amount must be greater than 0': {
    fr: 'Le montant doit être supérieur à 0',
    ar: 'يجب أن يكون المبلغ أكبر من 0',
  },
  'date must be YYYY-MM-DD': {
    fr: 'La date doit être au format AAAA-MM-JJ',
    ar: 'يجب أن يكون التاريخ بصيغة YYYY-MM-DD',
  },
  'emp_id is required': { fr: "L'employé est obligatoire", ar: 'الموظف مطلوب' },
  'reason is required': { fr: 'Le motif est obligatoire', ar: 'السبب مطلوب' },
  // generic (AllExceptionsFilter)
  'The data sent was not valid': {
    fr: 'Les données envoyées ne sont pas valides',
    ar: 'البيانات المرسلة غير صالحة',
  },
  'The data sent is too large': {
    fr: 'Les données envoyées sont trop volumineuses',
    ar: 'البيانات المرسلة كبيرة جدًا',
  },
  'This link or record ID is not valid': {
    fr: "Ce lien ou cet identifiant n'est pas valide",
    ar: 'هذا الرابط أو المعرّف غير صالح',
  },
  'Something went wrong on our side. Please try again.': {
    fr: 'Un problème est survenu de notre côté. Veuillez réessayer.',
    ar: 'حدث خطأ من جهتنا. يرجى المحاولة مرة أخرى.',
  },
};

// Field names used inside messages (see FIELD_LABELS in the filter)
const FIELDS: Record<string, Tr> = {
  'employee number': { fr: "numéro d'employé", ar: 'رقم الموظف' },
  employee: { fr: 'employé', ar: 'الموظف' },
  'task number': { fr: 'numéro de poste', ar: 'رقم المنصب' },
  'task name': { fr: 'nom du poste', ar: 'اسم المنصب' },
  'first name': { fr: 'prénom', ar: 'الاسم الشخصي' },
  'last name': { fr: 'nom', ar: 'اللقب' },
  'base salary': { fr: 'salaire de base', ar: 'الراتب الأساسي' },
  'phone number': { fr: 'numéro de téléphone', ar: 'رقم الهاتف' },
  'start time': { fr: 'heure de début', ar: 'وقت البداية' },
  'end time': { fr: 'heure de fin', ar: 'وقت النهاية' },
  shift: { fr: 'créneau', ar: 'الفترة' },
  date: { fr: 'date', ar: 'التاريخ' },
  'device record': { fr: 'enregistrement de la pointeuse', ar: 'سجل الجهاز' },
  'device user': { fr: 'utilisateur de la pointeuse', ar: 'مستخدم الجهاز' },
  'sign-in link name': {
    fr: 'nom du lien de connexion',
    ar: 'اسم رابط الدخول',
  },
  'device serial': { fr: 'numéro de série', ar: 'الرقم التسلسلي' },
  email: { fr: 'e-mail', ar: 'البريد الإلكتروني' },
  value: { fr: 'valeur', ar: 'القيمة' },
  title: { fr: 'titre', ar: 'العنوان' },
  subtitle: { fr: "texte d'accueil", ar: 'نص الترحيب' },
  colour: { fr: 'couleur', ar: 'اللون' },
  'hours per day': { fr: 'heures par jour', ar: 'ساعات العمل في اليوم' },
  'working days per month': {
    fr: 'jours travaillés par mois',
    ar: 'أيام العمل في الشهر',
  },
  'weekly advance ratio': {
    fr: "part d'avance hebdomadaire",
    ar: 'نسبة التسبيق الأسبوعي',
  },
};

function field(name: string, lang: Exclude<ApiLang, 'en'>): string {
  return FIELDS[name.toLowerCase()]?.[lang] ?? name;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Messages with a variable part: [pattern, French, Arabic]
const PATTERNS: [
  RegExp,
  (m: RegExpMatchArray) => string,
  (m: RegExpMatchArray) => string,
][] = [
  [
    /^(.+) is already clocked in$/,
    (m) => `${m[1]} a déjà pointé son arrivée`,
    (m) => `${m[1]} سجّل حضوره بالفعل`,
  ],
  [
    /^(.+) isn't clocked in yet$/,
    (m) => `${m[1]} n'a pas encore pointé son arrivée`,
    (m) => `${m[1]} لم يسجّل حضوره بعد`,
  ],
  [
    /^The (.+) "(.+)" is already used$/,
    (m) => `${cap(field(m[1], 'fr'))} « ${m[2]} » est déjà utilisé`,
    (m) => `${field(m[1], 'ar')} «${m[2]}» مستخدم بالفعل`,
  ],
  [
    /^This (.+) is already used$/,
    (m) => `Ce ${field(m[1], 'fr')} est déjà utilisé`,
    (m) => `${field(m[1], 'ar')} مستخدم بالفعل`,
  ],
  [
    /^(.+) is required$/,
    (m) => `${cap(field(m[1], 'fr'))} : champ obligatoire`,
    (m) => `${field(m[1], 'ar')} مطلوب`,
  ],
  [
    /^(.+) is too small$/,
    (m) => `${cap(field(m[1], 'fr'))} : valeur trop petite`,
    (m) => `${field(m[1], 'ar')}: القيمة صغيرة جدًا`,
  ],
  [
    /^(.+) is too large$/,
    (m) => `${cap(field(m[1], 'fr'))} : valeur trop grande`,
    (m) => `${field(m[1], 'ar')}: القيمة كبيرة جدًا`,
  ],
  [
    /^(.+) has a value that isn't allowed$/,
    (m) => `${cap(field(m[1], 'fr'))} : valeur non autorisée`,
    (m) => `${field(m[1], 'ar')}: قيمة غير مسموح بها`,
  ],
  [
    /^(.+) has an invalid value$/,
    (m) => `${cap(field(m[1], 'fr'))} : valeur invalide`,
    (m) => `${field(m[1], 'ar')}: قيمة غير صالحة`,
  ],
  [
    /^(.+) must be between 0 and (\d+)$/,
    (m) => `${cap(field(m[1], 'fr'))} doit être entre 0 et ${m[2]}`,
    (m) => `يجب أن تكون ${field(m[1], 'ar')} بين 0 و${m[2]}`,
  ],
  [
    /^(.+) must be at most (\d+) characters$/,
    (m) => `${cap(field(m[1], 'fr'))} : ${m[2]} caractères maximum`,
    (m) => `${field(m[1], 'ar')}: ${m[2]} حرفًا كحد أقصى`,
  ],
  [
    /^Password must be at least (\d+) characters$/,
    (m) => `Le mot de passe doit contenir au moins ${m[1]} caractères`,
    (m) => `يجب أن تتكون كلمة المرور من ${m[1]} أحرف على الأقل`,
  ],
  [
    /^Role must be one of: (.+)$/,
    (m) => `Le rôle doit être l'un de : ${m[1]}`,
    (m) => `يجب أن يكون الدور أحد: ${m[1]}`,
  ],
  [
    /^Features must be from: (.+)$/,
    (m) => `Les fonctionnalités doivent être parmi : ${m[1]}`,
    (m) => `يجب أن تكون الميزات من: ${m[1]}`,
  ],
  [
    /^The "(.+)" feature is not enabled for this company$/,
    () => `Cette fonctionnalité n'est pas activée pour cette entreprise`,
    () => `هذه الميزة غير مفعّلة لهذه الشركة`,
  ],
  [
    /^Advance (.+) not found\.?$/,
    () => 'Avance introuvable',
    () => 'التسبيق غير موجود',
  ],
];

export function translateMessage(message: string, lang: ApiLang): string {
  if (lang === 'en' || typeof message !== 'string') return message;
  const exact = EXACT[message];
  if (exact) return exact[lang];
  for (const [re, fr, ar] of PATTERNS) {
    const m = message.match(re);
    if (m) return lang === 'fr' ? fr(m) : ar(m);
  }
  return message;
}
