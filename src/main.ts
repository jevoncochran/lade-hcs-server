import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.validation.js';

const bootstrap = async () => {
  // Config is validated while the app module loads; a bad setting stops
  // startup here with a list of what's wrong.
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Only the Lade website may call the API from a browser.
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }),
    credentials: true,
  });

  // Reject unknown fields and coerce types on every request body.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Lets Cloud Run stop the container cleanly (closes DB connections).
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
};

await bootstrap();
