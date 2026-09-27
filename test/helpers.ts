import type { AppConfig } from '../src/config.js';
import { openStore, type Store } from '../src/db.js';
import { handleMessage } from '../src/handleMessage.js';

export const NOW = new Date('2026-09-27T12:00:00.000Z');

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    currency: 'PKR',
    tz: 'Asia/Karachi',
    databasePath: ':memory:',
    port: 0,
    metaGraphVersion: 'v25.0',
    openaiModel: 'gpt-4o-mini',
    openaiBaseUrl: 'https://api.openai.com/v1',
    cliUser: 'me',
    ...overrides,
  };
}

export function testStore(): Store {
  return openStore(':memory:');
}

export async function say(store: Store, text: string, userId = 'alice'): Promise<string> {
  return handleMessage(userId, text, {
    db: store,
    now: NOW,
    config: testConfig(),
    llm: null,
  });
}
