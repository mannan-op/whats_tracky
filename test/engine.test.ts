import { describe, expect, it } from 'vitest';
import type { Llm } from '../src/llm.js';
import { handleMessage } from '../src/handleMessage.js';
import { say, testConfig, testStore, NOW } from './helpers.js';

describe('engine balance, report, goals, undo, reset', () => {
  it('tracks funds, spending, a rebased set, and a category report', async () => {
    const store = testStore();
    expect(await say(store, 'funds 50000')).toContain('Funds set to *PKR 50,000*');
    expect(await say(store, '500 food lunch')).toContain('Logged *PKR 500* · Food');
    expect(await say(store, 'spent 1200 on petrol')).toContain('Transport');
    expect(await say(store, 'groceries 3400')).toContain('Groceries');
    const tea = await say(store, '-250 tea');
    expect(tea).toContain('Left: *PKR 44,650*');

    const report = await say(store, 'report');
    expect(report).toContain('Total *PKR 5,350*');
    expect(report).toContain('Groceries — *PKR 3,400*');
    expect(report).toContain('Transport — *PKR 1,200*');
    expect(report).toContain('Food — *PKR 750*');

    await say(store, 'set funds 20000');
    expect(await say(store, 'balance')).toContain('Balance: *PKR 20,000*');
    expect(await say(store, 'where did I spend')).toContain('Total *PKR 5,350*');
  });

  it('sets a goal aside and gives a safe daily limit', async () => {
    const store = testStore();
    await say(store, 'funds 44650');
    const friday = await say(store, 'save 5000 for Friday');
    expect(friday).toContain('Set aside *PKR 5,000*');
    expect(friday).toContain('Available to spend: *PKR 39,650*');
    expect(friday).toContain('5 days to go');
    expect(friday).toContain('*PKR 7,930*');

    const wedding = await say(store, 'save 3000 for 2026-10-15 wedding');
    expect(wedding).toContain('Available to spend: *PKR 36,650*');
    expect(wedding).toContain('18 days to go');
    expect(wedding).toContain('*PKR 2,036.11*');

    const goals = await say(store, 'goals');
    expect(goals).toContain('1. Friday');
    expect(goals).toContain('2. wedding');
    expect(await say(store, 'delete goal 2')).toContain('Removed goal 2 (wedding');
    expect(await say(store, 'goals')).not.toContain('wedding');
  });

  it('warns when today exceeds the safe daily limit', async () => {
    const store = testStore();
    await say(store, 'funds 10000');
    await say(store, 'save 9000 for 2026-09-30');
    const reply = await say(store, '400 food lunch');
    expect(reply).toContain('over the safe daily limit');
    expect(reply).toContain('*PKR 333.33*');
  });

  it('undoes an expense, a goal, and a deleted goal', async () => {
    const store = testStore();
    await say(store, 'funds 1000');
    await say(store, '200 tea');
    expect(await say(store, 'balance')).toContain('*PKR 800*');
    const undone = await say(store, 'undo');
    expect(undone).toContain('Undid Food *PKR 200*');
    expect(undone).toContain('Balance: *PKR 1,000*');

    await say(store, 'save 300 for Friday');
    expect(await say(store, 'undo')).toContain('Undid saving *PKR 300*');
    expect(await say(store, 'goals')).toContain('No savings goals');

    await say(store, 'save 300 for Friday');
    await say(store, 'delete goal 1');
    expect(await say(store, 'undo')).toContain('Restored goal Friday');
    expect(await say(store, 'goals')).toContain('Friday');
    expect(await say(store, 'undo')).toContain('Undid saving *PKR 300*');
    expect(await say(store, 'undo')).toContain('Undid setting funds');
    expect(await say(store, 'undo')).toBe('Nothing to undo.');
  });

  it('requires YES before reset and keeps users apart', async () => {
    const store = testStore();
    await say(store, 'funds 1000');
    expect(await say(store, 'reset')).toContain('YES');
    expect(await say(store, 'balance')).toContain('*PKR 1,000*');
    expect(await say(store, 'YES')).toContain('Nothing is waiting');

    await say(store, 'funds 1000');
    await say(store, 'reset');
    expect(await say(store, 'no')).toContain('cancelled');
    expect(await say(store, 'balance')).toContain('*PKR 1,000*');

    await say(store, 'reset');
    expect(await say(store, 'yes')).toContain('All cleared');
    expect(await say(store, 'balance')).toContain('*PKR 0*');

    await say(store, 'funds 400', 'bob');
    expect(await say(store, 'balance', 'alice')).toContain('*PKR 0*');
    expect(await say(store, 'balance', 'bob')).toContain('*PKR 400*');
  });

  it('shares a phone identity across whatsapp prefixes and falls back to the model only when needed', async () => {
    const store = testStore();
    const config = testConfig();
    await handleMessage('whatsapp:+15551234567', 'funds 800', {
      db: store,
      now: NOW,
      config,
      llm: null,
    });
    const balance = await handleMessage('15551234567', 'balance', {
      db: store,
      now: NOW,
      config,
      llm: null,
    });
    expect(balance).toContain('*PKR 800*');

    let calls = 0;
    const llm: Llm = {
      async parse() {
        calls += 1;
        return { type: 'expense', amount: 42, note: 'mystery', category: 'other' };
      },
      async personalizeAdvice(ruleText: string) {
        return ruleText.replace('Advice', 'A friendlier note');
      },
    };
    await handleMessage('bob', 'balance', { db: store, now: NOW, config, llm });
    expect(calls).toBe(0);

    const logged = await handleMessage('bob', 'grabbed something on the way home', {
      db: store,
      now: NOW,
      config,
      llm,
    });
    expect(calls).toBe(1);
    expect(logged).toContain('*PKR 42*');

    await handleMessage('bob', 'funds 100', { db: store, now: NOW, config, llm });
    const advice = await handleMessage('bob', 'advice', { db: store, now: NOW, config, llm });
    expect(advice).toContain('A friendlier note');
    expect(advice).toContain('100');
  });
});
