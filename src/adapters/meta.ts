import type { Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import { isValidMetaSignature } from '../signatures.js';
import type { ServerDeps } from './types.js';

interface MetaTextMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}

interface RawRequest extends Request {
  rawBody?: Buffer;
}

export function readMetaMessages(body: unknown): MetaTextMessage[] {
  if (!body || typeof body !== 'object') return [];
  const entries = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const messages: MetaTextMessage[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const value = (change as { value?: { messages?: unknown } }).value;
      if (!value || !Array.isArray(value.messages)) continue;
      for (const message of value.messages) {
        if (message && typeof message === 'object') messages.push(message as MetaTextMessage);
      }
    }
  }
  return messages;
}

export async function sendMetaText(config: AppConfig, to: string, body: string): Promise<void> {
  if (!config.metaAccessToken || !config.metaPhoneNumberId) {
    throw new Error('Meta WhatsApp is not configured');
  }
  const url = `https://graph.facebook.com/${config.metaGraphVersion}/${config.metaPhoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.metaAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body, preview_url: false },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Meta send failed (${response.status}): ${detail.slice(0, 300)}`);
  }
}

export function handleMetaVerify(req: Request, res: Response, config: AppConfig): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (
    mode === 'subscribe' &&
    typeof token === 'string' &&
    typeof challenge === 'string' &&
    config.metaVerifyToken &&
    token === config.metaVerifyToken
  ) {
    res.status(200).type('text/plain').send(challenge);
    return;
  }
  res.sendStatus(403);
}

export async function handleMetaPost(req: RawRequest, res: Response, deps: ServerDeps): Promise<void> {
  const secret = deps.config.metaAppSecret;
  if (secret) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!isValidMetaSignature(raw, req.get('x-hub-signature-256'), secret)) {
      res.sendStatus(403);
      return;
    }
  }

  const messages = readMetaMessages(req.body);
  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  const send = deps.sendMetaText ?? ((to: string, body: string) => sendMetaText(deps.config, to, body));

  for (const message of messages) {
    if (message.type !== 'text' || !message.from || !message.text?.body?.trim()) continue;
    if (message.id && !deps.claimMessage(message.id, nowIso)) continue;
    try {
      const reply = await deps.handle(message.from, message.text.body);
      await send(message.from, reply);
    } catch (error) {
      if (message.id) deps.releaseMessage(message.id);
      throw error;
    }
  }

  res.sendStatus(200);
}
