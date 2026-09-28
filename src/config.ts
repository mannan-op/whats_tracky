import { safeTimeZone } from './dates.js';

export interface AppConfig {
  currency: string;
  tz: string;
  databasePath: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  port: number;
  publicUrl?: string;
  twilioAuthToken?: string;
  twilioWhatsappFrom?: string;
  metaVerifyToken?: string;
  metaAccessToken?: string;
  metaPhoneNumberId?: string;
  metaAppSecret?: string;
  metaGraphVersion: string;
  openaiApiKey?: string;
  openaiModel: string;
  openaiBaseUrl: string;
  cliUser: string;
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? '3000');
  return {
    currency: (env.CURRENCY ?? 'PKR').trim() || 'PKR',
    tz: safeTimeZone((env.TZ ?? 'Asia/Karachi').trim() || 'Asia/Karachi'),
    databasePath: (env.DATABASE_PATH ?? './data/budget.db').trim() || './data/budget.db',
    tursoDatabaseUrl: blankToUndefined(env.TURSO_DATABASE_URL),
    tursoAuthToken: blankToUndefined(env.TURSO_AUTH_TOKEN),
    port: Number.isFinite(port) && port > 0 ? port : 3000,
    publicUrl: blankToUndefined(env.PUBLIC_URL)?.replace(/\/$/, ''),
    twilioAuthToken: blankToUndefined(env.TWILIO_AUTH_TOKEN),
    twilioWhatsappFrom: blankToUndefined(env.TWILIO_WHATSAPP_FROM),
    metaVerifyToken: blankToUndefined(env.META_VERIFY_TOKEN),
    metaAccessToken: blankToUndefined(env.META_ACCESS_TOKEN),
    metaPhoneNumberId: blankToUndefined(env.META_PHONE_NUMBER_ID),
    metaAppSecret: blankToUndefined(env.META_APP_SECRET),
    metaGraphVersion: (env.META_GRAPH_VERSION ?? 'v25.0').trim() || 'v25.0',
    openaiApiKey: blankToUndefined(env.OPENAI_API_KEY),
    openaiModel: (env.OPENAI_MODEL ?? 'gpt-4o-mini').trim() || 'gpt-4o-mini',
    openaiBaseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').trim().replace(/\/$/, ''),
    cliUser: (env.CLI_USER ?? 'me').trim() || 'me',
  };
}
