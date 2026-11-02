# Writing tests

Jest + ts-jest, two projects in `jest.config.js`:

| Project | Files | What it is |
|---------|-------|------------|
| `unit` | `src/**/*.spec.ts`, next to the file they test (`foo.ts` → `foo.spec.ts`) | Plain functions and classes, no database |
| `integration` | `test/**/*.e2e-spec.ts` | The real app (`AppModule` + `configureApp`, as in `main.ts`) on a throw-away MongoDB, called over HTTP with supertest |

```
npm test                              # everything
npm run test:unit                     # unit only
npm run test:e2e                      # integration only
npm run test:security                 # test/security.e2e-spec.ts
npm run test:cov                      # everything, with coverage → coverage/index.html
npx jest test/employees               # one file or folder
npx jest src/common --coverage --collectCoverageFrom='src/common/**'   # one folder's coverage
```

`test:cov` fails when coverage drops below the thresholds in `jest.config.js`. They are raised after
every phase of [TEST_PLAN.md](TEST_PLAN.md).

The first run downloads a MongoDB binary (`mongodb-memory-server`, ~70 MB, cached afterwards).

## CI

`.github/workflows/ci.yml` runs on every push and pull request to `dev` and `main`: `npm ci`, lint,
`npm run build`, `npm run test:cov` (fails on a failing test or coverage below the thresholds). The
coverage report is attached to each run as the `coverage` artifact.

- Lint covers the tests only (`test/**/*.ts`, `src/**/*.spec.ts`): the application code in `src/` still
  has older lint errors. Add `src/` to the lint step once they are cleaned up.
- Never put `npm run lint` in CI or run it on `src/`: it runs `eslint --fix` and rewrites files.
- On Windows, ESLint reports `Delete ␍` on files Git checked out with CRLF line endings. CI runs on
  Linux and never sees them; run Prettier on the file if it bothers you locally.
- A bug test (`it.failing`) that starts passing fails the run: change it to `it` in the fix commit.

## Helpers (`test/helpers/`)

| File | What it gives you |
|------|-------------------|
| `app.ts` | `createTestApp()`: boots the app on its own database (call once per file in `beforeAll`, `t.close()` in `afterAll`). Returns `{ app, model(name), wipe(), close() }`. `api(app, { token, companyId, ip })`: supertest client that looks like a browser behind Render's proxy (HTTPS, `X-Forwarded-For`, desktop Chrome), with a new IP per client so rate limits don't spill between tests. |
| `seed.ts` | `seeder(t)`: `company()`, `user(role, companyId)`, `employee()`, `shift()`, `task()`, `planning()`, `worktime()`, `advance()`, `bonus()` write straight to the database inside the right company; `find(companyId, model, filter)` reads back what was stored. `loginAs(t, user, { companyId })` logs in over HTTP and returns an `api` client with the token. Every user's password is `PASSWORD`. `unknownId()` is a valid id that matches nothing. |
| `time.ts` | `withTimeZone('Africa/Algiers', fn)` runs date code in another time zone. `setNow(iso)` fixes "now" without freezing the timers Nest and Mongoose need; undo with `jest.useRealTimers()`. |
| `fake-zklib.ts` | Replaces `node-zklib` everywhere. Set `fakeDevice.users`, `fakeDevice.attendances` or `fakeDevice.reachable = false`; `fakeDevice.reset()` in `afterEach`. |
| `setup-env.ts` | Runs before every test file: `NODE_ENV=test`, `TZ=UTC`, a test `JWT_SECRET`, HTTPS forced, high route rate limit. |
| `global-setup.ts` | Starts one MongoDB for the whole run; each file gets its own database in it. |

Typical integration test:

```ts
let t: TestApp;
let seed: ReturnType<typeof seeder>;
beforeAll(async () => { t = await createTestApp(); seed = seeder(t); });
afterAll(() => t.close());

it("doesn't show another company's employee", async () => {
  const mine = await seed.company();
  const other = await seed.company();
  const theirs = await seed.employee(other.id);
  const admin = await loginAs(t, await seed.user('admin', mine.id));

  const res = await admin.get(`/employees/${theirs._id}`);

  expect(res.status).toBe(404);
});
```

## Rules

1. **When the code is wrong, don't bend the test.** Write the test for the correct behaviour, mark it
   `it.failing(...)`, put `// BUG-0XX: <one line>` on the line above, and add the entry to
   `docs/TEST_FINDINGS.md` or the area file in `docs/findings/`.
2. **Don't change application code to make tests pass.** Fixes go in their own commits
   (`fix(BUG-0XX): …`).
3. **Test behaviour through the API**: status code, response body, what ends up in the database,
   what is written to the activity log. Not private methods.
4. **Every route gets the access checks**: no token → 401, wrong role → 403, another company's
   record → not found, and nothing changed.
5. **Keep tests independent.** Create the data each test needs (two companies when isolation
   matters); don't rely on order. Restore `process.env`, timers and `fakeDevice` after changing them.
6. **Silence expected logs** with `jest.spyOn(console, 'error').mockImplementation(() => {})` in that
   test only. The app is created with `logger: false`.
7. **Time zones:** servers run in UTC, restaurants in Algeria (UTC+1). Test date code in both, and
   around midnight, overnight shifts and month ends.
8. **Coverage exclusions** go in `jest.config.js` *and* the table in `TEST_FINDINGS.md`, with the reason.
