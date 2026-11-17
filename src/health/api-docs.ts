import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * The API's documentation, at /docs (and as JSON at /docs-json): every
 * route, grouped by area, with the sign-in it needs. Generated from the
 * code, so it is never out of date.
 *
 * Shown unless API_DOCS=off. The page only describes the routes: every
 * route still needs a valid sign-in to answer.
 */
export function setupApiDocs(app: INestApplication) {
  if (process.env.API_DOCS === 'off') return false;
  const config = new DocumentBuilder()
    .setTitle('Nexo InOuty API')
    .setDescription(
      [
        'Planning, clock-in, attendance and payroll for many companies.',
        '',
        'Sign in with `POST /auth/login` to get an access token, then send it as `Authorization: Bearer <token>`.',
        'A super admin works inside a company by adding `X-Company-Id: <company id>`.',
        'Messages come back in the language of `Accept-Language` (en, fr, ar).',
      ].join('\n'),
    )
    .setVersion(process.env.npm_package_version ?? '1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // Every route is tagged with its first path segment: /payroll/period → payroll
  for (const [path, item] of Object.entries(document.paths)) {
    const tag = path.split('/')[1] || 'health';
    for (const operation of Object.values(item)) {
      if (operation && typeof operation === 'object' && 'responses' in operation) {
        operation.tags = operation.tags?.length ? operation.tags : [tag];
        operation.security = [{ bearer: [] }];
      }
    }
  }
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Nexo InOuty API',
    swaggerOptions: { persistAuthorization: false, docExpansion: 'none' },
  });
  return true;
}
