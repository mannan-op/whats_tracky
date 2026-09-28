import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient, type Client, type ResultSet, type Row } from '@libsql/client';
import { SCHEMA } from './schema.js';
import { buildStore, createSession, enqueueOn, type SqlArgs, type SqlDriver, type SqlExecutor, type Store } from './sql.js';

export interface LibsqlOptions {
  url: string;
  authToken?: string;
}

function rowObject(row: Row, columns: string[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const column of columns) record[column] = row[column];
  return record;
}

interface Executable {
  execute(stmt: { sql: string; args?: SqlArgs }): Promise<ResultSet>;
}

function libsqlExecutor(target: Executable): SqlExecutor {
  return {
    async run(sql, args = []) {
      const result = await target.execute({ sql, args });
      return { lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
    },
    async get(sql, args = []) {
      const result = await target.execute({ sql, args });
      const row = result.rows[0];
      return row ? rowObject(row, result.columns) : undefined;
    },
    async all(sql, args = []) {
      const result = await target.execute({ sql, args });
      return result.rows.map((row) => rowObject(row, result.columns));
    },
  };
}

function filePathFromUrl(url: string): string | null {
  if (!url.startsWith('file:')) return null;
  const path = url.slice('file:'.length);
  if (path === '' || path === ':memory:') return null;
  return path;
}

export async function openLibsqlStore(options: LibsqlOptions): Promise<Store> {
  const filePath = filePathFromUrl(options.url);
  if (filePath) mkdirSync(dirname(filePath), { recursive: true });

  const client = createClient({
    url: options.url,
    authToken: options.authToken,
    intMode: 'number',
  });
  await client.executeMultiple(SCHEMA);
  return buildLibsqlStore(client);
}

function buildLibsqlStore(client: Client): Store {
  const root = libsqlExecutor(client);
  const { active, mutex } = createSession();

  const driver: SqlDriver = {
    current: () => active.getStore() ?? root,
    enqueue: (fn) => enqueueOn(active, mutex, fn),
    transaction: (fn) =>
      enqueueOn(active, mutex, async () => {
        if (active.getStore()) return fn();
        const tx = await client.transaction('write');
        try {
          const result = await active.run(libsqlExecutor(tx), fn);
          await tx.commit();
          return result;
        } catch (error) {
          if (!tx.closed) await tx.rollback();
          throw error;
        } finally {
          tx.close();
        }
      }),
    async close() {
      client.close();
    },
  };
  return buildStore(driver);
}
