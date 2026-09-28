import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA } from './schema.js';
import { buildStore, createSession, enqueueOn, type SqlDriver, type SqlExecutor, type Store } from './sql.js';

function sqliteExecutor(db: Database.Database): SqlExecutor {
  return {
    async run(sql, args = []) {
      const result = db.prepare(sql).run(...args);
      return { lastInsertRowid: Number(result.lastInsertRowid) };
    },
    async get(sql, args = []) {
      return db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
    },
    async all(sql, args = []) {
      return db.prepare(sql).all(...args) as Record<string, unknown>[];
    },
  };
}

export function openSqliteStore(filename: string): Store {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const root = sqliteExecutor(db);
  const { active, mutex } = createSession();
  const driver: SqlDriver = {
    current: () => active.getStore() ?? root,
    enqueue: (fn) => enqueueOn(active, mutex, fn),
    transaction: (fn) =>
      enqueueOn(active, mutex, async () => {
        if (active.getStore()) return fn();
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await active.run(root, fn);
          db.exec('COMMIT');
          return result;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }),
    async close() {
      db.close();
    },
  };
  return buildStore(driver);
}
