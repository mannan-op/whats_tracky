import type { AppConfig } from './config.js';
import { openLibsqlStore } from './libsqlStore.js';
import { openSqliteStore } from './sqliteStore.js';
import type { Store } from './sql.js';

export type { NewGoal, NewLedger, Store } from './sql.js';
export { openLibsqlStore } from './libsqlStore.js';
export { openSqliteStore } from './sqliteStore.js';

export async function openStore(
  config: Pick<AppConfig, 'databasePath' | 'tursoDatabaseUrl' | 'tursoAuthToken'>,
): Promise<Store> {
  if (config.tursoDatabaseUrl) {
    return openLibsqlStore({ url: config.tursoDatabaseUrl, authToken: config.tursoAuthToken });
  }
  return openSqliteStore(config.databasePath);
}

const opening = new Map<string, Promise<Store>>();

export function getStore(config: Pick<AppConfig, 'databasePath' | 'tursoDatabaseUrl' | 'tursoAuthToken'>): Promise<Store> {
  const key = config.tursoDatabaseUrl ? `turso:${config.tursoDatabaseUrl}` : `sqlite:${config.databasePath}`;
  const existing = opening.get(key);
  if (existing) return existing;
  const created = openStore(config);
  opening.set(key, created);
  created.catch(() => {
    if (opening.get(key) === created) opening.delete(key);
  });
  return created;
}
