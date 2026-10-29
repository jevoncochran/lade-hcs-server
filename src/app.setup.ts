import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { requireProxySecret } from './common/proxy-secret.middleware.js';
import { NodeEnv, type Env } from './config/env.validation.js';

// Shared by main.ts and the e2e tests so both run the same request pipeline.
export const configureApp = (app: NestExpressApplication) => {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Only the website may reach the API: it adds PROXY_SECRET to every
  // request it forwards (src/app/api/[...path]/route.ts in the website).
  // Checked before anything else; /health stays open for Cloud Run's checks.
  const proxySecret = config.get('PROXY_SECRET', { infer: true });
  if (proxySecret) app.use(requireProxySecret(proxySecret));

  // Behind Google's front ends (and the website), trust that many proxies so
  // req.ip (rate limits, audit log) is the visitor's address. Safe because
  // requests that skipped the website were refused above.
  if (config.get('NODE_ENV', { infer: true }) === NodeEnv.Production) {
    app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
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
