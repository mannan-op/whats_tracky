import { AsyncLocalStorage } from 'node:async_hooks';
import { isCategory } from './categories.js';
import type { Category, GoalRow, LedgerKind, LedgerRow, UndoEntry, UndoOp } from './types.js';

export type SqlValue = string | number | null;
export type SqlArgs = SqlValue[];

export interface SqlExecutor {
  run(sql: string, args?: SqlArgs): Promise<{ lastInsertRowid: number }>;
  get(sql: string, args?: SqlArgs): Promise<Record<string, unknown> | undefined>;
  all(sql: string, args?: SqlArgs): Promise<Record<string, unknown>[]>;
}

export interface SqlDriver {
  current(): SqlExecutor;
  enqueue<T>(fn: () => Promise<T>): Promise<T>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface NewLedger {
  userId: string;
  kind: LedgerKind;
  amount: number;
  category: Category | null;
  note: string | null;
  createdAt: string;
}

export interface NewGoal {
  id?: number;
  userId: string;
  amount: number;
  targetDate: string;
  label: string;
  createdAt: string;
}

export interface Store {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  ensureUser(userId: string, nowIso: string): Promise<void>;
  isPendingReset(userId: string): Promise<boolean>;
  setPendingReset(userId: string, pending: boolean): Promise<void>;
  insertLedger(entry: NewLedger): Promise<LedgerRow>;
  listLedger(userId: string): Promise<LedgerRow[]>;
  deleteLedger(id: number, userId: string): Promise<LedgerRow | null>;
  insertGoal(entry: NewGoal): Promise<GoalRow>;
  listGoals(userId: string): Promise<GoalRow[]>;
  deleteGoal(id: number, userId: string): Promise<GoalRow | null>;
  pushUndo(userId: string, op: UndoOp, payload: unknown, nowIso: string): Promise<void>;
  popUndo(userId: string): Promise<UndoEntry | null>;
  clearUser(userId: string): Promise<void>;
  claimMessage(messageId: string, nowIso: string): Promise<boolean>;
  releaseMessage(messageId: string): Promise<void>;
  close(): Promise<void>;
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(fn, fn).finally(release);
  }
}

export function createSession(): {
  active: AsyncLocalStorage<SqlExecutor>;
  mutex: Mutex;
} {
  return { active: new AsyncLocalStorage<SqlExecutor>(), mutex: new Mutex() };
}

export function enqueueOn<T>(
  active: AsyncLocalStorage<SqlExecutor>,
  mutex: Mutex,
  fn: () => Promise<T>,
): Promise<T> {
  if (active.getStore()) return fn();
  return mutex.run(fn);
}

export function isUniqueError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.includes('UNIQUE constraint failed')) return true;
  if (!('code' in error)) return false;
  const code = error.code;
  return code === 'SQLITE_CONSTRAINT' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  throw new Error(`Expected number for ${field}`);
}

function asString(value: unknown, field: string): string {
  if (typeof value === 'string') return value;
  throw new Error(`Expected string for ${field}`);
}

function asKind(value: string): LedgerKind {
  if (value === 'set_funds' || value === 'add_funds' || value === 'expense') return value;
  throw new Error(`Unexpected ledger kind ${value}`);
}

function asUndoOp(value: string): UndoOp {
  if (value === 'delete_ledger' || value === 'delete_goal' || value === 'insert_goal') return value;
  throw new Error(`Unexpected undo op ${value}`);
}

function mapLedger(row: Record<string, unknown>): LedgerRow {
  const categoryRaw = row.category;
  const note = row.note;
  return {
    id: asNumber(row.id, 'id'),
    userId: asString(row.user_id, 'user_id'),
    kind: asKind(asString(row.kind, 'kind')),
    amount: asNumber(row.amount, 'amount'),
    category: typeof categoryRaw === 'string' && isCategory(categoryRaw) ? categoryRaw : null,
    note: typeof note === 'string' ? note : null,
    createdAt: asString(row.created_at, 'created_at'),
  };
}

function mapGoal(row: Record<string, unknown>): GoalRow {
  return {
    id: asNumber(row.id, 'id'),
    userId: asString(row.user_id, 'user_id'),
    amount: asNumber(row.amount, 'amount'),
    targetDate: asString(row.target_date, 'target_date'),
    label: asString(row.label, 'label'),
    createdAt: asString(row.created_at, 'created_at'),
  };
}

export function buildStore(driver: SqlDriver): Store {
  return {
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      return driver.transaction(fn);
    },
    async ensureUser(userId: string, nowIso: string): Promise<void> {
      await driver.enqueue(async () => {
        await driver.current().run(
          'INSERT OR IGNORE INTO users (id, pending_reset, created_at) VALUES (?, 0, ?)',
          [userId, nowIso],
        );
      });
    },
    async isPendingReset(userId: string): Promise<boolean> {
      return driver.enqueue(async () => {
        const row = await driver.current().get('SELECT pending_reset FROM users WHERE id = ?', [userId]);
        return row !== undefined && asNumber(row.pending_reset, 'pending_reset') === 1;
      });
    },
    async setPendingReset(userId: string, pending: boolean): Promise<void> {
      await driver.enqueue(async () => {
        await driver.current().run('UPDATE users SET pending_reset = ? WHERE id = ?', [pending ? 1 : 0, userId]);
      });
    },
    async insertLedger(entry: NewLedger): Promise<LedgerRow> {
      return driver.enqueue(async () => {
        const sql = driver.current();
        const result = await sql.run(
          `INSERT INTO ledger (user_id, kind, amount, category, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [entry.userId, entry.kind, entry.amount, entry.category, entry.note, entry.createdAt],
        );
        const row = await sql.get('SELECT * FROM ledger WHERE id = ?', [result.lastInsertRowid]);
        if (!row) throw new Error('Inserted ledger row is missing');
        return mapLedger(row);
      });
    },
    async listLedger(userId: string): Promise<LedgerRow[]> {
      return driver.enqueue(async () => {
        const rows = await driver.current().all('SELECT * FROM ledger WHERE user_id = ? ORDER BY id ASC', [userId]);
        return rows.map(mapLedger);
      });
    },
    async deleteLedger(id: number, userId: string): Promise<LedgerRow | null> {
      return driver.enqueue(async () => {
        const sql = driver.current();
        const row = await sql.get('SELECT * FROM ledger WHERE id = ? AND user_id = ?', [id, userId]);
        if (!row) return null;
        await sql.run('DELETE FROM ledger WHERE id = ? AND user_id = ?', [id, userId]);
        return mapLedger(row);
      });
    },
    async insertGoal(entry: NewGoal): Promise<GoalRow> {
      return driver.enqueue(async () => {
        const sql = driver.current();
        if (entry.id === undefined) {
          const result = await sql.run(
            `INSERT INTO goals (user_id, amount, target_date, label, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [entry.userId, entry.amount, entry.targetDate, entry.label, entry.createdAt],
          );
          const row = await sql.get('SELECT * FROM goals WHERE id = ?', [result.lastInsertRowid]);
          if (!row) throw new Error('Inserted goal row is missing');
          return mapGoal(row);
        }
        await sql.run(
          `INSERT INTO goals (id, user_id, amount, target_date, label, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [entry.id, entry.userId, entry.amount, entry.targetDate, entry.label, entry.createdAt],
        );
        const row = await sql.get('SELECT * FROM goals WHERE id = ?', [entry.id]);
        if (!row) throw new Error('Inserted goal row is missing');
        return mapGoal(row);
      });
    },
    async listGoals(userId: string): Promise<GoalRow[]> {
      return driver.enqueue(async () => {
        const rows = await driver
          .current()
          .all('SELECT * FROM goals WHERE user_id = ? ORDER BY target_date ASC, id ASC', [userId]);
        return rows.map(mapGoal);
      });
    },
    async deleteGoal(id: number, userId: string): Promise<GoalRow | null> {
      return driver.enqueue(async () => {
        const sql = driver.current();
        const row = await sql.get('SELECT * FROM goals WHERE id = ? AND user_id = ?', [id, userId]);
        if (!row) return null;
        await sql.run('DELETE FROM goals WHERE id = ? AND user_id = ?', [id, userId]);
        return mapGoal(row);
      });
    },
    async pushUndo(userId: string, op: UndoOp, payload: unknown, nowIso: string): Promise<void> {
      await driver.enqueue(async () => {
        await driver
          .current()
          .run('INSERT INTO undo (user_id, op, payload, created_at) VALUES (?, ?, ?, ?)', [
            userId,
            op,
            JSON.stringify(payload),
            nowIso,
          ]);
      });
    },
    async popUndo(userId: string): Promise<UndoEntry | null> {
      return driver.enqueue(async () => {
        const sql = driver.current();
        const row = await sql.get('SELECT id, op, payload FROM undo WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
        if (!row) return null;
        const id = asNumber(row.id, 'id');
        await sql.run('DELETE FROM undo WHERE id = ?', [id]);
        return { id, op: asUndoOp(asString(row.op, 'op')), payload: asString(row.payload, 'payload') };
      });
    },
    async clearUser(userId: string): Promise<void> {
      await driver.enqueue(async () => {
        const sql = driver.current();
        await sql.run('DELETE FROM ledger WHERE user_id = ?', [userId]);
        await sql.run('DELETE FROM goals WHERE user_id = ?', [userId]);
        await sql.run('DELETE FROM undo WHERE user_id = ?', [userId]);
        await sql.run('UPDATE users SET pending_reset = 0 WHERE id = ?', [userId]);
      });
    },
    async claimMessage(messageId: string, nowIso: string): Promise<boolean> {
      return driver.enqueue(async () => {
        const sql = driver.current();
        const cutoff = new Date(Date.parse(nowIso) - 2 * 86_400_000).toISOString();
        await sql.run('DELETE FROM seen_messages WHERE created_at < ?', [cutoff]);
        try {
          await sql.run('INSERT INTO seen_messages (message_id, created_at) VALUES (?, ?)', [messageId, nowIso]);
          return true;
        } catch (error) {
          if (isUniqueError(error)) return false;
          throw error;
        }
      });
    },
    async releaseMessage(messageId: string): Promise<void> {
      await driver.enqueue(async () => {
        await driver.current().run('DELETE FROM seen_messages WHERE message_id = ?', [messageId]);
      });
    },
    close(): Promise<void> {
      return driver.close();
    },
  };
}
