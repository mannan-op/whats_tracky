import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const keys = Object.keys(params).sort();
  let payload = url;
  for (const key of keys) payload += key + params[key];
  return createHmac('sha1', authToken).update(payload, 'utf8').digest('base64');
}

export function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
  authToken: string,
): boolean {
  if (!signature) return false;
  return safeEqual(twilioSignature(url, params, authToken), signature);
}

export function metaSignature(rawBody: Buffer, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function isValidMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header) return false;
  return safeEqual(metaSignature(rawBody, appSecret), header);
}
