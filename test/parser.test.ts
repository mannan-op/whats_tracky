import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/parser.js';

const today = '2026-09-27';

function parse(text: string) {
  return parseMessage(text, { today });
}

describe('parser funds', () => {
  it('sets funds from the common phrasings', () => {
    expect(parse('funds 50000')).toEqual({ type: 'set_funds', amount: 50000 });
    expect(parse('fund 50000')).toEqual({ type: 'set_funds', amount: 50000 });
    expect(parse('set funds 50000')).toEqual({ type: 'set_funds', amount: 50000 });
    expect(parse('set my funds to 50,000')).toEqual({ type: 'set_funds', amount: 50000 });
    expect(parse('my funds are PKR 50000')).toEqual({ type: 'set_funds', amount: 50000 });
    expect(parse('funds 50k')).toEqual({ type: 'set_funds', amount: 50000 });
    expect(parse('funds 0')).toEqual({ type: 'set_funds', amount: 0 });
  });

  it('adds funds without treating the word funds alone as a set', () => {
    expect(parse('add funds 10000')).toEqual({ type: 'add_funds', amount: 10000 });
    expect(parse('add fund 10,000')).toEqual({ type: 'add_funds', amount: 10000 });
    expect(parse('add 10000 to funds')).toEqual({ type: 'add_funds', amount: 10000 });
    expect(parse('funds')).toEqual({ type: 'balance' });
  });
});

describe('parser expenses', () => {
  it('reads amount-first, spent, category-first, and leading minus', () => {
    expect(parse('500 food lunch')).toEqual({
      type: 'expense',
      amount: 500,
      note: 'lunch',
      category: 'food',
    });
    expect(parse('spent 1200 on petrol')).toEqual({
      type: 'expense',
      amount: 1200,
      note: 'petrol',
      category: 'transport',
    });
    expect(parse('groceries 3400')).toEqual({
      type: 'expense',
      amount: 3400,
      note: 'groceries',
      category: 'groceries',
    });
    expect(parse('-250 tea')).toEqual({
      type: 'expense',
      amount: 250,
      note: 'tea',
      category: 'food',
    });
    expect(parse('paid 800 for medicine')).toEqual({
      type: 'expense',
      amount: 800,
      note: 'medicine',
      category: 'health',
    });
    expect(parse('1,500 gas bill')).toEqual({
      type: 'expense',
      amount: 1500,
      note: 'gas bill',
      category: 'bills',
    });
    expect(parse('1500 gas')).toMatchObject({ category: 'transport', note: 'gas' });
    expect(parse('200 mystery')).toMatchObject({ category: 'other', note: 'mystery' });
    expect(parse('500')).toMatchObject({ type: 'expense', amount: 500, category: 'other' });
  });

  it('does not collapse two amounts into one expense', () => {
    expect(parse('500 lunch and 200 tea').type).toBe('unknown');
  });
});

describe('parser commands', () => {
  it('recognizes balance, reports, goals, and maintenance commands', () => {
    expect(parse('balance').type).toBe('balance');
    expect(parse('left').type).toBe('balance');
    expect(parse('how much left').type).toBe('balance');
    expect(parse("what's left").type).toBe('balance');
    expect(parse('how much do I have left?').type).toBe('balance');

    expect(parse('report')).toEqual({ type: 'report', period: 'month' });
    expect(parse('where did I spend')).toEqual({ type: 'report', period: 'month' });
    expect(parse('summary week')).toEqual({ type: 'report', period: 'week' });
    expect(parse('summary month')).toEqual({ type: 'report', period: 'month' });
    expect(parse('report all')).toEqual({ type: 'report', period: 'all' });
    expect(parse('where did I spend this week')).toEqual({ type: 'report', period: 'week' });

    expect(parse('goals').type).toBe('goals');
    expect(parse('delete goal 2')).toEqual({ type: 'delete_goal', index: 2 });
    expect(parse('remove goal #1')).toEqual({ type: 'delete_goal', index: 1 });
    expect(parse('undo').type).toBe('undo');
    expect(parse('history').type).toBe('history');
    expect(parse('advice').type).toBe('advice');
    expect(parse('tips').type).toBe('advice');
    expect(parse('help').type).toBe('help');
    expect(parse('reset').type).toBe('reset');
    expect(parse('YES').type).toBe('confirm');
    expect(parse('no').type).toBe('cancel');
  });
});

describe('parser savings dates', () => {
  it('parses weekdays, iso dates, and month names', () => {
    expect(parse('save 5000 for Friday')).toEqual({
      type: 'save',
      amount: 5000,
      targetDate: '2026-10-02',
      label: 'Friday',
    });
    expect(parse('save 3000 for 2026-10-15 wedding')).toEqual({
      type: 'save',
      amount: 3000,
      targetDate: '2026-10-15',
      label: 'wedding',
    });
    expect(parse('save 3000 for 15 Oct wedding')).toEqual({
      type: 'save',
      amount: 3000,
      targetDate: '2026-10-15',
      label: 'wedding',
    });
    expect(parse('reserve 1500 until 15/10/2026 rent')).toMatchObject({
      type: 'save',
      amount: 1500,
      targetDate: '2026-10-15',
      label: 'rent',
    });
    expect(parse('set aside 800 for tomorrow').type).toBe('save');
    expect(parse('save 5000 for notaday').type).toBe('unknown');
  });

  it('treats a bare weekday as the coming day, including today', () => {
    expect(parseMessage('save 100 for Friday', { today: '2026-10-02' })).toMatchObject({
      targetDate: '2026-10-02',
    });
    expect(parseMessage('save 100 for next Friday', { today: '2026-09-27' })).toMatchObject({
      targetDate: '2026-10-09',
    });
  });
});
