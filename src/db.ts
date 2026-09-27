import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Category, GoalRow, LedgerKind, LedgerRow, UndoEntry, UndoOp } from './types.js';
import { isCategory } from './categories.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  pending_reset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('set_funds', 'add_funds', 'expense')),
  amount REAL NOT NULL CHECK (amount >= 0),
  category TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  target_date TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS undo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('delete_ledger', 'delete_goal', 'insert_goal')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seen_messages (
  message_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id, target_date, id);
CREATE INDEX IF NOT EXISTS idx_undo_user ON undo(user_id, id);
`;

interface LedgerSql {
  id: number;
  user_id: string;
  kind: string;
  amount: number;
  category: string | null;
  note: string | null;
  created_at: string;
}

interface GoalSql {
  id: number;
  user_id: string;
  amount: number;
  target_date: string;
  label: string;
  created_at: string;
}

function asKind(value: string): LedgerKind {
  if (value === 'set_funds' || value === 'add_funds' || value === 'expense') return value;
  throw new Error(`Unexpected ledger kind ${value}`);
}

function mapLedger(row: LedgerSql): LedgerRow {
  const category = row.category && isCategory(row.category) ? row.category : null;
  return {
    id: row.id,
    userId: row.user_id,
    kind: asKind(row.kind),
    amount: row.amount,
    category,
    note: row.note,
    createdAt: row.created_at,
  };
}

function mapGoal(row: GoalSql): GoalRow {
  return {
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    targetDate: row.target_date,
    label: row.label,
    createdAt: row.created_at,
  };
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
  transaction<T>(fn: () => T): T;
  ensureUser(userId: string, nowIso: string): void;
  isPendingReset(userId: string): boolean;
  setPendingReset(userId: string, pending: boolean): void;
  insertLedger(entry: NewLedger): LedgerRow;
  listLedger(userId: string): LedgerRow[];
  deleteLedger(id: number, userId: string): LedgerRow | null;
  insertGoal(entry: NewGoal): GoalRow;
  listGoals(userId: string): GoalRow[];
  deleteGoal(id: number, userId: string): GoalRow | null;
  pushUndo(userId: string, op: UndoOp, payload: unknown, nowIso: string): void;
  popUndo(userId: string): UndoEntry | null;
  clearUser(userId: string): void;
  claimMessage(messageId: string, nowIso: string): boolean;
  releaseMessage(messageId: string): void;
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}

export function openStore(filename: string): Store {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  return {
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
    ensureUser(userId: string, nowIso: string): void {
      db.prepare('INSERT OR IGNORE INTO users (id, pending_reset, created_at) VALUES (?, 0, ?)').run(userId, nowIso);
    },
    isPendingReset(userId: string): boolean {
      const row = db.prepare('SELECT pending_reset FROM users WHERE id = ?').get(userId) as
        | { pending_reset: number }
        | undefined;
      return row?.pending_reset === 1;
    },
    setPendingReset(userId: string, pending: boolean): void {
      db.prepare('UPDATE users SET pending_reset = ? WHERE id = ?').run(pending ? 1 : 0, userId);
    },
    insertLedger(entry: NewLedger): LedgerRow {
      const result = db
        .prepare(
          `INSERT INTO ledger (user_id, kind, amount, category, note, created_at)
           VALUES (@userId, @kind, @amount, @category, @note, @createdAt)`,
        )
        .run(entry);
      const row = db.prepare('SELECT * FROM ledger WHERE id = ?').get(Number(result.lastInsertRowid)) as LedgerSql;
      return mapLedger(row);
    },
    listLedger(userId: string): LedgerRow[] {
      const rows = db.prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY id ASC').all(userId) as LedgerSql[];
      return rows.map(mapLedger);
    },
    deleteLedger(id: number, userId: string): LedgerRow | null {
      const row = db.prepare('SELECT * FROM ledger WHERE id = ? AND user_id = ?').get(id, userId) as LedgerSql | undefined;
      if (!row) return null;
      db.prepare('DELETE FROM ledger WHERE id = ? AND user_id = ?').run(id, userId);
      return mapLedger(row);
    },
    insertGoal(entry: NewGoal): GoalRow {
      if (entry.id === undefined) {
        const result = db
          .prepare(
            `INSERT INTO goals (user_id, amount, target_date, label, created_at)
             VALUES (@userId, @amount, @targetDate, @label, @createdAt)`,
          )
          .run(entry);
        const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(Number(result.lastInsertRowid)) as GoalSql;
        return mapGoal(row);
      }
      db.prepare(
        `INSERT INTO goals (id, user_id, amount, target_date, label, created_at)
         VALUES (@id, @userId, @amount, @targetDate, @label, @createdAt)`,
      ).run(entry);
      const row = db.prepare('SELECT * FROM goals WHERE id = ?').get(entry.id) as GoalSql;
      return mapGoal(row);
    },
    listGoals(userId: string): GoalRow[] {
      const rows = db
        .prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY target_date ASC, id ASC')
        .all(userId) as GoalSql[];
      return rows.map(mapGoal);
    },
    deleteGoal(id: number, userId: string): GoalRow | null {
      const row = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(id, userId) as GoalSql | undefined;
      if (!row) return null;
      db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(id, userId);
      return mapGoal(row);
    },
    pushUndo(userId: string, op: UndoOp, payload: unknown, nowIso: string): void {
      db.prepare('INSERT INTO undo (user_id, op, payload, created_at) VALUES (?, ?, ?, ?)').run(
        userId,
        op,
        JSON.stringify(payload),
        nowIso,
      );
    },
    popUndo(userId: string): UndoEntry | null {
      const row = db
        .prepare('SELECT id, op, payload FROM undo WHERE user_id = ? ORDER BY id DESC LIMIT 1')
        .get(userId) as { id: number; op: string; payload: string } | undefined;
      if (!row) return null;
      db.prepare('DELETE FROM undo WHERE id = ?').run(row.id);
      if (row.op !== 'delete_ledger' && row.op !== 'delete_goal' && row.op !== 'insert_goal') {
        throw new Error(`Unexpected undo op ${row.op}`);
      }
      return { id: row.id, op: row.op, payload: row.payload };
    },
    clearUser(userId: string): void {
      db.prepare('DELETE FROM ledger WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM goals WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM undo WHERE user_id = ?').run(userId);
      db.prepare('UPDATE users SET pending_reset = 0 WHERE id = ?').run(userId);
    },
    claimMessage(messageId: string, nowIso: string): boolean {
      const cutoff = new Date(Date.parse(nowIso) - 2 * 86_400_000).toISOString();
      db.prepare('DELETE FROM seen_messages WHERE created_at < ?').run(cutoff);
      try {
        db.prepare('INSERT INTO seen_messages (message_id, created_at) VALUES (?, ?)').run(messageId, nowIso);
        return true;
      } catch (error) {
        if (isUniqueError(error)) return false;
        throw error;
      }
    },
    releaseMessage(messageId: string): void {
      db.prepare('DELETE FROM seen_messages WHERE message_id = ?').run(messageId);
    },
  };
}

let cached: { path: string; store: Store } | null = null;

export function getStore(filename: string): Store {
  if (cached?.path === filename) return cached.store;
  const store = openStore(filename);
  cached = { path: filename, store };
  return store;
}
