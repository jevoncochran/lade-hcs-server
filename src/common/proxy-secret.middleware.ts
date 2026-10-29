import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const PROXY_SECRET_HEADER = 'x-lade-proxy';

const digest = (value: string) => createHash('sha256').update(value).digest();

// Refuses requests that didn't come through the website (see PROXY_SECRET).
// Compared in constant time, on hashes so lengths can't leak either.
export const requireProxySecret = (secret: string) => {
  const expected = digest(secret);
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method === 'GET' && request.path === '/health') return next();
    const given = request.headers[PROXY_SECRET_HEADER];
    if (typeof given === 'string' && timingSafeEqual(digest(given), expected)) {
      return next();
    }
    response.status(403).json({ message: 'Forbidden' });
  };
};
