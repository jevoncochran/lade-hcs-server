import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { NodeEnv, type Env } from './config/env.validation.js';

// Shared by main.ts and the e2e tests so both run the same request pipeline.
export const configureApp = (app: NestExpressApplication) => {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Cloud Run sits behind one Google proxy; trust it so req.ip (used for rate
  // limiting and the audit log) is the client's address, not the proxy's.
  // TODO (deploy): confirm the hop count against real Cloud Run traffic.
  if (config.get('NODE_ENV', { infer: true }) === NodeEnv.Production) {
    app.set('trust proxy', 1);
  }

  // Only the Lade website may call the API from a browser, with cookies.
  app.enableCors({
    origin: config.get('SITE_URL', { infer: true }),
    credentials: true,
  });

  // Don't advertise the framework in response headers.
  app.disable('x-powered-by');

  app.use(cookieParser());

  // Reject unknown fields and coerce types on every request body.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  return app;
};
