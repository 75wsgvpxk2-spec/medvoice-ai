import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { config, ROOT } from './lib/config.ts';
import { api } from './routes/api.ts';
import { installResolver } from './lib/thresholds.ts';

/**
 * Builds the Express application, without binding a port.
 *
 * Split out of index.ts so the suite can mount the real app and drive it over
 * HTTP. Until this existed every test ran in-process, which meant no route
 * guard, no auth middleware and no admin gate was exercised by any test — and
 * that is precisely how four routes came to authorise on the wrong thing
 * without a single test noticing.
 *
 * Boot work — the session-secret check, the clinical reference verification,
 * the scheduler — stays in index.ts. Importing this module must not start
 * anything.
 */
export function createApp() {
  const app = express();

  // Only when the operator has said how many proxies to trust. See config.ts.
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  /*
   * Security headers.
   *
   * The CSP suits what this application actually is: a same-origin SPA with no
   * third-party scripts. `connect-src` has to allow the AssemblyAI socket, since
   * dictation streams from the browser directly rather than through this server —
   * that is deliberate (the audio never touches the clinic's own machine) and it
   * means the CSP has to say so out loud.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Vite injects styles at runtime; the alternative is a nonce pipeline
          // that buys little for an application serving no third-party content.
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          // Logos are stored as data URIs in the database.
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https://streaming.assemblyai.com', 'wss://streaming.assemblyai.com'],
          // No embedding: a clinical record in somebody else's iframe is a
          // clickjacking target.
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      // Sent only over HTTPS, which is where it means anything.
      hsts: config.isProd,
      // The browser's own referrer default leaks patient ids in URLs to any
      // outbound link.
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Express 5 removed res.cookie helpers from the base response in some setups;
  // these are the only two cookie operations the API performs.
  app.use((_req, res, next) => {
    res.cookie = function cookie(name: string, value: string, options: Record<string, unknown> = {}) {
      const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
      if (options['httpOnly']) parts.push('HttpOnly');
      if (options['secure']) parts.push('Secure');
      if (options['sameSite']) parts.push(`SameSite=${String(options['sameSite'])}`);
      if (typeof options['maxAge'] === 'number') parts.push(`Max-Age=${Math.floor(options['maxAge'] / 1000)}`);
      res.append('Set-Cookie', parts.join('; '));
      return res;
    } as typeof res.cookie;

    res.clearCookie = function clearCookie(name: string) {
      res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0`);
      return res;
    } as typeof res.clearCookie;

    next();
  });

  // Clinic threshold adjustments must be live before the first rule evaluates.
  installResolver();

  // Agent automations. Starts the minute tick and catches up anything missed
  // while the server was down.

  app.use('/api', api);

  // In production the built client is served from the same origin.
  const clientDist = path.join(ROOT, 'client', 'dist');
  if (config.isProd && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  /**
   * The last middleware: anything that threw and was not handled ends here.
   *
   * Express's default handler puts the stack trace in the response body whenever
   * NODE_ENV is not exactly "production" — which is easy to get wrong on a
   * self-hosted install, and hands an attacker the file layout of a system
   * holding patient records. The detail goes to the log; the client gets a
   * sentence.
   */
  app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error(`UNHANDLED ${req.method} ${req.path}`, error);
    if (res.headersSent) return;
    res.status(500).json({
      error: 'Something went wrong handling that request. Nothing was changed. Try again.',
    });
  });

  return app;
}
