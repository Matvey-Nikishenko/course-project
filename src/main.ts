import { ConfigService } from '@nestjs/config';
import { createApp } from './configure-app';
import { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  console.log(`Marketplace API (NestJS) on http://localhost:${port}`);
}

bootstrap();
