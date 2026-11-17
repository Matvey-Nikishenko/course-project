import { assertAuthSecrets } from './auth/secrets';

// Before Nest, and before the database pool. A missing signing key has to be
// the error the process names. Importing the app graph first can fail on Postgres
// and hide the variable.
assertAuthSecrets(process.env);

async function bootstrap(): Promise<void> {
  const { createApp } = await import('./configure-app');
  const { ConfigService } = await import('@nestjs/config');
  const app = await createApp();
  const config = app.get(ConfigService);
  const port = config.get('PORT');
  await app.listen(port);
  console.log(`Marketplace API (NestJS) on http://localhost:${port}`);
}

bootstrap();
