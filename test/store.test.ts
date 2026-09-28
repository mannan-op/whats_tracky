import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openLibsqlStore, openSqliteStore, openStore, type Store } from '../src/db.js';

const NOW = '2026-09-27T12:00:00.000Z';
const openStores: Store[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(openStores.splice(0).map((store) => store.close()));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function libsqlFileStore(): Promise<Store> {
  const dir = await mkdtemp(join(tmpdir(), 'whats-tracky-'));
  directories.push(dir);
  const store = await openLibsqlStore({ url: `file:${join(dir, 'budget.db')}` });
  openStores.push(store);
  return store;
}

function sqliteStore(): Store {
  const store = openSqliteStore(':memory:');
  openStores.push(store);
  return store;
}

async function exercise(store: Store): Promise<void> {
  await store.ensureUser('alice', NOW);
  await store.ensureUser('alice', NOW);
  expect(await store.isPendingReset('alice')).toBe(false);
  await store.setPendingReset('alice', true);
  expect(await store.isPendingReset('alice')).toBe(true);

  const expense = await store.insertLedger({
    userId: 'alice',
    kind: 'expense',
    amount: 500,
    category: 'food',
    note: 'lunch',
    createdAt: NOW,
  });
  const funds = await store.insertLedger({
    userId: 'alice',
    kind: 'set_funds',
    amount: 1000,
    category: null,
    note: null,
    createdAt: NOW,
  });
  const ledger = await store.listLedger('alice');
  expect(ledger.map((row) => row.id)).toEqual([expense.id, funds.id]);
  expect(ledger[0]).toMatchObject({ kind: 'expense', amount: 500, category: 'food', note: 'lunch' });

  await store.pushUndo('alice', 'delete_ledger', { id: funds.id }, NOW);
  await store.pushUndo('alice', 'delete_goal', { id: 9 }, NOW);
  const top = await store.popUndo('alice');
  expect(top).toMatchObject({ op: 'delete_goal', payload: JSON.stringify({ id: 9 }) });
  const next = await store.popUndo('alice');
  expect(next?.op).toBe('delete_ledger');
  expect(await store.popUndo('alice')).toBeNull();

  const removed = await store.deleteLedger(expense.id, 'alice');
  expect(removed?.id).toBe(expense.id);
  expect(await store.listLedger('alice')).toHaveLength(1);
  expect(await store.deleteLedger(expense.id, 'alice')).toBeNull();

  const goal = await store.insertGoal({
    userId: 'alice',
    amount: 3000,
    targetDate: '2026-10-15',
    label: 'wedding',
    createdAt: NOW,
  });
  await store.deleteGoal(goal.id, 'alice');
  const restored = await store.insertGoal({
    id: goal.id,
    userId: 'alice',
    amount: goal.amount,
    targetDate: goal.targetDate,
    label: goal.label,
    createdAt: NOW,
  });
  expect(restored.id).toBe(goal.id);
  expect(await store.listGoals('alice')).toEqual([restored]);
  expect(await store.deleteGoal(goal.id, 'bob')).toBeNull();

  expect(await store.claimMessage('msg-1', NOW)).toBe(true);
  expect(await store.claimMessage('msg-1', NOW)).toBe(false);
  await store.releaseMessage('msg-1');
  expect(await store.claimMessage('msg-1', NOW)).toBe(true);

  await store.clearUser('alice');
  expect(await store.listLedger('alice')).toEqual([]);
  expect(await store.listGoals('alice')).toEqual([]);
  expect(await store.isPendingReset('alice')).toBe(false);
  expect(await store.popUndo('alice')).toBeNull();

  await expect(
    store.transaction(async () => {
      await store.insertLedger({
        userId: 'alice',
        kind: 'add_funds',
        amount: 20,
        category: null,
        note: null,
        createdAt: NOW,
      });
      throw new Error('rollback');
    }),
  ).rejects.toThrow('rollback');
  expect(await store.listLedger('alice')).toEqual([]);

  await store.transaction(async () => {
    const row = await store.insertLedger({
      userId: 'alice',
      kind: 'add_funds',
      amount: 20,
      category: null,
      note: null,
      createdAt: NOW,
    });
    await store.pushUndo('alice', 'delete_ledger', { id: row.id }, NOW);
  });
  expect(await store.listLedger('alice')).toHaveLength(1);
  expect((await store.popUndo('alice'))?.op).toBe('delete_ledger');
}

describe('storage interface', () => {
  it('runs the same operations on local SQLite', async () => {
    await exercise(sqliteStore());
  });

  it('runs the same operations on libSQL with a file: URL', async () => {
    await exercise(await libsqlFileStore());
  });

  it('keeps local SQLite when Turso variables are unset', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:' });
    expect(config.tursoDatabaseUrl).toBeUndefined();
    expect(config.tursoAuthToken).toBeUndefined();
    const store = await openStore(config);
    openStores.push(store);
    await store.ensureUser('me', NOW);
    const row = await store.insertLedger({
      userId: 'me',
      kind: 'expense',
      amount: 10,
      category: 'other',
      note: 'tea',
      createdAt: NOW,
    });
    expect((await store.listLedger('me'))[0]?.id).toBe(row.id);
  });

  it('uses libSQL when TURSO_DATABASE_URL is set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'whats-tracky-'));
    directories.push(dir);
    const url = `file:${join(dir, 'remote.db')}`;
    const config = loadConfig({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: 'unused-local-token' });
    expect(config.tursoDatabaseUrl).toBe(url);
    const store = await openStore(config);
    openStores.push(store);
    await store.ensureUser('me', NOW);
    expect(await store.listGoals('me')).toEqual([]);
  });
});
