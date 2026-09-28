import type { Request, Response } from 'express';
import { escapeXml } from '../format.js';
import { isValidTwilioSignature } from '../signatures.js';
import type { ServerDeps } from './types.js';

export function twilioRequestUrl(req: Request, publicUrl: string | undefined): string {
  if (publicUrl) return `${publicUrl}${req.originalUrl}`;
  const forwardedProto = req.get('x-forwarded-proto');
  const proto = (forwardedProto ?? req.protocol).split(',')[0]?.trim() || 'https';
  const host = (req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost').split(',')[0]?.trim();
  return `${proto}://${host}${req.originalUrl}`;
}

export function formParams(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') return {};
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') params[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') params[key] = value[0];
  }
  return params;
}

function twiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
}

function emptyTwiml(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
}

export async function handleTwilio(req: Request, res: Response, deps: ServerDeps): Promise<void> {
  const params = formParams(req.body);
  const token = deps.config.twilioAuthToken;
  if (token) {
    const url = twilioRequestUrl(req, deps.config.publicUrl);
    const signature = req.get('x-twilio-signature');
    if (!isValidTwilioSignature(url, params, signature, token)) {
      res.status(403).type('text/plain').send('Invalid Twilio signature');
      return;
    }
  }

  const from = params.From ?? '';
  const body = (params.Body ?? '').trim();
  const messageId = params.MessageSid;
  if (!from || !body) {
    res.status(200).type('text/xml').send(emptyTwiml());
    return;
  }

  const nowIso = (deps.now?.() ?? new Date()).toISOString();
  if (messageId && !(await deps.claimMessage(messageId, nowIso))) {
    res.status(200).type('text/xml').send(emptyTwiml());
    return;
  }

  try {
    const reply = await deps.handle(from, body);
    res.status(200).type('text/xml').send(twiml(reply));
  } catch (error) {
    if (messageId) await deps.releaseMessage(messageId);
    throw error;
  }
}
