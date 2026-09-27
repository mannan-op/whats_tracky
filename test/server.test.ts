import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';
import { metaSignature, twilioSignature } from '../src/signatures.js';
import { handleMessage } from '../src/handleMessage.js';
import { NOW, testConfig, testStore } from './helpers.js';

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function listen(app: ReturnType<typeof createApp>): Promise<string> {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  servers.push({
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  });
  return `http://127.0.0.1:${address.port}`;
}

function appFor(config = testConfig()) {
  const store = testStore();
  const sent: string[] = [];
  const app = createApp({
    config,
    now: () => NOW,
    handle: (userId, text) => handleMessage(userId, text, { db: store, config, now: NOW, llm: null }),
    claimMessage: (messageId, nowIso) => store.claimMessage(messageId, nowIso),
    releaseMessage: (messageId) => store.releaseMessage(messageId),
    sendMetaText: async (_to, body) => {
      sent.push(body);
    },
  });
  return { app, sent };
}

describe('http adapters', () => {
  it('answers health, Twilio sandbox posts, and Meta verification', async () => {
    const { app, sent } = appFor(testConfig({ metaVerifyToken: 'secret', metaAppSecret: 'app-secret' }));
    const base = await listen(app);

    const health = await fetch(`${base}/health`);
    expect(await health.json()).toEqual({ ok: true });

    const twilio = await fetch(`${base}/webhooks/twilio`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: 'whatsapp:+15551230000', Body: 'funds 50000', MessageSid: 'SM1' }).toString(),
    });
    expect(twilio.status).toBe(200);
    expect(await twilio.text()).toContain('Funds set to *PKR 50,000*');

    const verify = await fetch(
      `${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=secret&hub.challenge=12345`,
    );
    expect(await verify.text()).toBe('12345');
    expect(
      (
        await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345`)
      ).status,
    ).toBe(403);

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '15551230000', id: 'wamid.1', type: 'text', text: { body: 'balance' } }],
              },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const signed = await fetch(`${base}/webhooks/meta`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': metaSignature(Buffer.from(raw), 'app-secret'),
      },
      body: raw,
    });
    expect(signed.status).toBe(200);
    expect(sent[0]).toContain('*PKR 50,000*');

    const forged = await fetch(`${base}/webhooks/meta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=nope' },
      body: raw,
    });
    expect(forged.status).toBe(403);
  });

  it('rejects a Twilio post when the signature does not match', async () => {
    const { app } = appFor(testConfig({ twilioAuthToken: 'token', publicUrl: 'https://example.com' }));
    const base = await listen(app);
    const params = { From: 'whatsapp:+15551230000', Body: 'balance' };
    const bad = await fetch(`${base}/webhooks/twilio`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'nope' },
      body: new URLSearchParams(params).toString(),
    });
    expect(bad.status).toBe(403);

    const goodSignature = twilioSignature('https://example.com/webhooks/twilio', params, 'token');
    const good = await fetch(`${base}/webhooks/twilio`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': goodSignature,
      },
      body: new URLSearchParams(params).toString(),
    });
    expect(good.status).toBe(200);
  });
});
