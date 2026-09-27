import { describe, expect, it } from 'vitest';
import { buildReport, computeBalance, dailyBurn, percentShares, planGoals } from '../src/calc.js';
import type { ExpenseView } from '../src/calc.js';

describe('computeBalance', () => {
  it('applies the latest set as a new baseline, then adds and expenses', () => {
    expect(
      computeBalance([
        { kind: 'add_funds', amount: 10 },
        { kind: 'expense', amount: 3 },
      ]),
    ).toBe(7);

    expect(
      computeBalance([
        { kind: 'set_funds', amount: 100 },
        { kind: 'add_funds', amount: 10 },
        { kind: 'expense', amount: 25 },
      ]),
    ).toBe(85);

    expect(
      computeBalance([
        { kind: 'expense', amount: 40 },
        { kind: 'set_funds', amount: 100 },
        { kind: 'expense', amount: 5 },
      ]),
    ).toBe(95);
  });
});

describe('buildReport', () => {
  const expenses: ExpenseView[] = [
    { amount: 10, category: 'food', note: 'lunch', localDate: '2026-09-27' },
    { amount: 10, category: 'groceries', note: 'milk', localDate: '2026-09-26' },
    { amount: 10, category: 'transport', note: 'petrol', localDate: '2026-09-20' },
    { amount: 5, category: 'food', note: 'tea', localDate: '2026-09-01' },
  ];

  it('totals the month, assigns percents that sum to 100, and lists top items', () => {
    const report = buildReport(expenses, '2026-09-01', '2026-09-27');
    expect(report.total).toBe(35);
    expect(report.categories.map((category) => [category.category, category.total, category.percent])).toEqual([
      ['food', 15, 43],
      ['groceries', 10, 29],
      ['transport', 10, 28],
    ]);
    expect(report.categories.reduce((sum, category) => sum + category.percent, 0)).toBe(100);
    expect(report.top[0]).toMatchObject({ note: 'lunch', amount: 10 });
  });

  it('limits a week window to the last 7 days', () => {
    const report = buildReport(expenses, '2026-09-21', '2026-09-27');
    expect(report.total).toBe(20);
    expect(report.categories.map((category) => category.category)).toEqual(['food', 'groceries']);
  });

  it('splits equal shares with the remainder on the first category', () => {
    expect(percentShares([10, 10, 10])).toEqual([34, 33, 33]);
  });
});

describe('planGoals', () => {
  it('reserves money and divides what is left by the days until the nearest goal', () => {
    const friday = planGoals(44650, [{ amount: 5000, targetDate: '2026-10-02', label: 'Friday' }], '2026-09-27');
    expect(friday.reserved).toBe(5000);
    expect(friday.available).toBe(39650);
    expect(friday.horizonDays).toBe(5);
    expect(friday.safeDailyLimit).toBe(7930);
    expect(friday.goals[0]?.dailyLimit).toBe(7930);

    const both = planGoals(
      44650,
      [
        { amount: 5000, targetDate: '2026-10-02', label: 'Friday' },
        { amount: 3000, targetDate: '2026-10-15', label: 'wedding' },
      ],
      '2026-09-27',
    );
    expect(both.reserved).toBe(8000);
    expect(both.available).toBe(36650);
    expect(both.horizonDate).toBe('2026-10-02');
    expect(both.safeDailyLimit).toBe(7330);
    expect(both.goals.find((goal) => goal.label === 'wedding')?.dailyLimit).toBe(2036.11);
  });

  it('keeps the daily limit stable after spending already counted in the balance', () => {
    const plan = planGoals(9600, [{ amount: 9000, targetDate: '2026-09-30', label: 'Savings' }], '2026-09-27', 400);
    expect(plan.available).toBe(600);
    expect(plan.safeDailyLimit).toBe(333.33);
  });

  it('marks an unaffordable goal and a zero daily limit', () => {
    const plan = planGoals(1000, [{ amount: 5000, targetDate: '2026-10-02', label: 'Friday' }], '2026-09-27');
    expect(plan.available).toBe(-4000);
    expect(plan.safeDailyLimit).toBe(0);
    expect(plan.goals[0]?.feasible).toBe(false);
  });

  it('has no daily limit when there are no goals', () => {
    expect(planGoals(100, [], '2026-09-27').safeDailyLimit).toBeNull();
  });
});

describe('dailyBurn', () => {
  it('averages the last 7 days including quiet days', () => {
    expect(dailyBurn([{ amount: 700, localDate: '2026-09-27' }], '2026-09-27', '2026-09-21')).toBe(100);
  });
});
