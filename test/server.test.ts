import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { sendMetaText } from '../src/adapters/meta.js';
import { loadConfig } from '../src/config.js';
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

async function appFor(config = testConfig()) {
  const store = await testStore();
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
  return { app, sent, store };
}

function metaPayload(body: string, id: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              messages: [{ from: '15551230000', id, type: 'text', text: { body } }],
            },
          },
        ],
      },
    ],
  });
}

async function postMeta(base: string, raw: string, secret: string, signature?: string): Promise<Response> {
  return fetch(`${base}/webhooks/meta`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature ?? metaSignature(Buffer.from(raw), secret),
    },
    body: raw,
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error('timed out waiting for webhook work');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('http adapters', () => {
  it('answers health, Twilio sandbox posts, and Meta verification', async () => {
    const { app, sent } = await appFor(testConfig({ metaVerifyToken: 'secret', metaAppSecret: 'app-secret' }));
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

    const raw = metaPayload('balance', 'wamid.1');
    const signed = await postMeta(base, raw, 'app-secret');
    expect(signed.status).toBe(200);
    await waitFor(() => sent.length > 0);
    expect(sent[0]).toContain('*PKR 50,000*');
  });

  it('rejects a Meta post when X-Hub-Signature-256 does not match', async () => {
    const { app, sent } = await appFor(testConfig({ metaAppSecret: 'app-secret' }));
    const base = await listen(app);
    const raw = metaPayload('500 lunch', 'wamid.sig');

    const missing = await fetch(`${base}/webhooks/meta`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });
    expect(missing.status).toBe(403);

    const forged = await postMeta(base, raw, 'app-secret', 'sha256=nope');
    expect(forged.status).toBe(403);
    expect(sent).toEqual([]);

    const signed = await postMeta(base, raw, 'app-secret');
    expect(signed.status).toBe(200);
    await waitFor(() => sent.length === 1);
    expect(sent[0]).toContain('Logged *PKR 500*');
  });

  it('returns 200 for Meta status updates and does not reply', async () => {
    const { app, sent } = await appFor(testConfig({ metaAppSecret: 'app-secret' }));
    const base = await listen(app);
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                statuses: [{ id: 'wamid.status', status: 'delivered', recipient_id: '15551230000' }],
              },
            },
          ],
        },
      ],
    });
    const response = await postMeta(base, raw, 'app-secret');
    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sent).toEqual([]);
  });

  it('acks a Meta message before processing and ignores a duplicate message id', async () => {
    const store = await testStore();
    const config = testConfig({ metaAppSecret: 'app-secret' });
    const sent: string[] = [];
    let releaseHandle: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseHandle = resolve;
    });
    let started = 0;
    const app = createApp({
      config,
      now: () => NOW,
      handle: async (userId, text) => {
        started += 1;
        await gate;
        return handleMessage(userId, text, { db: store, config, now: NOW, llm: null });
      },
      claimMessage: (messageId, nowIso) => store.claimMessage(messageId, nowIso),
      releaseMessage: (messageId) => store.releaseMessage(messageId),
      sendMetaText: async (_to, body) => {
        sent.push(body);
      },
    });
    const base = await listen(app);
    const raw = metaPayload('500 lunch', 'wamid.once');

    const first = postMeta(base, raw, 'app-secret');
    const acked = await Promise.race([
      first,
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => reject(new Error('Meta ack waited for processing')), 500);
      }),
    ]);
    expect(acked.status).toBe(200);
    expect(started).toBe(1);
    expect(sent).toEqual([]);

    const retry = await postMeta(base, raw, 'app-secret');
    expect(retry.status).toBe(200);
    expect(started).toBe(1);

    releaseHandle();
    await first;
    await waitFor(() => sent.length === 1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('Logged *PKR 500*');
    expect(await store.listLedger('15551230000')).toHaveLength(1);
  });

  it('sends Meta replies with the current Graph API version', async () => {
    expect(loadConfig({}).metaGraphVersion).toBe('v26.0');
    const calls: Array<{ url: string; body: string }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? '') });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      await sendMetaText(
        testConfig({ metaAccessToken: 'token', metaPhoneNumberId: '109876', metaGraphVersion: 'v26.0' }),
        '15551230000',
        'Left: PKR 500',
      );
    } finally {
      globalThis.fetch = original;
    }
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v26.0/109876/messages');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      messaging_product: 'whatsapp',
      to: '15551230000',
      type: 'text',
      text: { body: 'Left: PKR 500' },
    });
  });

  it('rejects a Twilio post when the signature does not match', async () => {
    const { app } = await appFor(testConfig({ twilioAuthToken: 'token', publicUrl: 'https://example.com' }));
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
