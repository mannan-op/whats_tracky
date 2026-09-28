import { loadConfig, type AppConfig } from './config.js';
import { getStore, type Store } from './db.js';
import { dispatch } from './engine.js';
import { formatYmd } from './dates.js';
import { clipReply } from './format.js';
import { createLlm, type Llm } from './llm.js';
import { parseMessage } from './parser.js';

export interface HandleOptions {
  db?: Store;
  now?: Date;
  config?: AppConfig;
  llm?: Llm | null;
}

export function normalizeUserId(id: string): string {
  const stripped = id.replace(/^whatsapp:/i, '').trim();
  const digits = stripped.replace(/[^\d]/g, '');
  if (digits.length >= 8 && digits.length <= 15 && /^\+?[\d\s()-]+$/.test(stripped)) return digits;
  const safe = stripped.replace(/\s+/g, ' ').slice(0, 80);
  return safe || 'unknown';
}

export async function handleMessage(userId: string, text: string, options: HandleOptions = {}): Promise<string> {
  const config = options.config ?? loadConfig();
  const store = options.db ?? (await getStore(config));
  const now = options.now ?? new Date();
  const llm = options.llm === undefined ? createLlm(config) : options.llm;
  const trimmed = text.trim();
  if (!trimmed) return 'Send something like `500 tea` or `balance`. Type *help* for commands.';
  if (trimmed.length > 1000) return 'That message is too long. Try a shorter one.';

  const today = formatYmd(now, config.tz);
  let intent = parseMessage(trimmed, { today });
  if (intent.type === 'unknown' && llm) {
    const parsed = await llm.parse(trimmed, today);
    if (parsed) intent = parsed;
  }
  const reply = await dispatch(normalizeUserId(userId), intent, { store, config, now, llm });
  return clipReply(reply);
}
