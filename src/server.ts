import 'dotenv/config';
import express, { type Request } from 'express';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleMetaPost, handleMetaVerify } from './adapters/meta.js';
import { handleTwilio } from './adapters/twilio.js';
import type { ServerDeps } from './adapters/types.js';
import { loadConfig } from './config.js';
import { getStore } from './db.js';
import { handleMessage } from './handleMessage.js';

interface RawRequest extends Request {
  rawBody?: Buffer;
}

export function createApp(deps: ServerDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/', (_req, res) => {
    res.type('text/plain').send('whats-tracky budget bot');
  });

  app.post('/webhooks/twilio', express.urlencoded({ extended: false }), (req, res, next) => {
    handleTwilio(req, res, deps).catch(next);
  });

  app.get('/webhooks/meta', (req, res) => {
    handleMetaVerify(req, res, deps.config);
  });

  app.post(
    '/webhooks/meta',
    express.json({
      verify: (req, _res, buf) => {
        (req as RawRequest).rawBody = Buffer.from(buf);
      },
    }),
    (req, res, next) => {
      handleMetaPost(req, res, deps).catch(next);
    },
  );

  app.use((error: unknown, _req: Request, res: express.Response, _next: express.NextFunction) => {
    console.error('request failed', error instanceof Error ? error.message : error);
    if (!res.headersSent) res.status(500).type('text/plain').send('Something went wrong');
  });

  return app;
}

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const store = await getStore(config);
  const app = createApp({
    config,
    handle: (userId, text) => handleMessage(userId, text, { config, db: store }),
    claimMessage: (messageId, nowIso) => store.claimMessage(messageId, nowIso),
    releaseMessage: (messageId) => store.releaseMessage(messageId),
  });
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, '0.0.0.0', () => resolve());
    server.on('error', reject);
  });
  const database = config.tursoDatabaseUrl ? 'turso' : config.databasePath;
  console.log(`whats-tracky listening on 0.0.0.0:${config.port}`);
  console.log(`currency ${config.currency}, tz ${config.tz}, db ${database}`);
  console.log(`twilio signature checks ${config.twilioAuthToken ? 'on' : 'off'}`);
  console.log(`twilio from ${config.twilioWhatsappFrom ?? 'unset'}`);
  console.log(`meta replies ${config.metaAccessToken && config.metaPhoneNumberId ? 'on' : 'off'}`);
  console.log(`openai fallback ${config.openaiApiKey ? 'on' : 'off'}`);
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  startServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
