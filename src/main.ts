import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.validation.js';

const bootstrap = async () => {
  // Config is validated while the app module loads; a bad setting stops
  // startup here with a list of what's wrong.
  // rawBody: Stripe webhook signatures are checked against the exact bytes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  configureApp(app);

  // Lets Cloud Run stop the container cleanly (closes DB connections).
  app.enableShutdownHooks();

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
};

await bootstrap();
