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
  it('sets a single-goal cap to the unreserved balance divided by the days, rounded down', () => {
    // 27 Sep → 2 Oct is 5 days. Spendable = 44,650 − 5,000 = 39,650.
    // 39,650 / 5 = 7,930. 7,930 × 5 = 39,650, so the reserve is untouched.
    const friday = planGoals(
      44650,
      [{ amount: 5000, targetDate: '2026-10-02', label: 'Friday' }],
      '2026-09-27',
      { unit: 1 },
    );
    expect(friday.reserved).toBe(5000);
    expect(friday.available).toBe(39650);
    expect(friday.horizonDays).toBe(5);
    expect(friday.safeDailyLimit).toBe(7930);
    expect(friday.goals[0]?.dailyLimit).toBe(7930);
    expect(friday.overToday).toBe(false);
    expect(friday.leftToday).toBe(7930);
  });

  it('uses the strictest goal when a later reserve must also survive', () => {
    // Friday, 5 days: hold 8,000, spendable 36,650, floor(36,650 / 5) = 7,330.
    // Wedding, 18 days: hold only the 3,000 still due then (Friday's 5,000 can be used after 2 Oct).
    // Spendable 41,650, floor(41,650 / 18) = 2,313. 2,313 × 18 = 41,634 ≤ 41,650.
    // Strictest cap is 2,313. Today's 5,350 is already over it.
    const both = planGoals(
      44650,
      [
        { amount: 5000, targetDate: '2026-10-02', label: 'Friday' },
        { amount: 3000, targetDate: '2026-10-15', label: 'wedding' },
      ],
      '2026-09-27',
      { unit: 1, todaySpend: 5350 },
    );
    expect(both.reserved).toBe(8000);
    expect(both.available).toBe(36650);
    expect(both.goals.find((goal) => goal.label === 'Friday')?.dailyLimit).toBe(7330);
    expect(both.goals.find((goal) => goal.label === 'wedding')?.dailyLimit).toBe(2313);
    expect(both.safeDailyLimit).toBe(2313);
    expect(both.horizonDate).toBe('2026-10-15');
    expect(both.horizonDays).toBe(18);
    expect(both.overToday).toBe(true);
    expect(both.leftToday).toBe(0);
  });

  it('counts spending already done today against the cap and does not add it back', () => {
    // Balance 9,600 already excludes today's 400. Reserve 9,000. 27 Sep → 30 Sep is 3 days.
    // Spendable = 600. floor(600 / 3) = 200. 200 × 3 = 600.
    // Putting the 400 back would show floor(1,000 / 3) = 333, and 333 × 3 exceeds the 600 left.
    const over = planGoals(
      9600,
      [{ amount: 9000, targetDate: '2026-09-30', label: 'Savings' }],
      '2026-09-27',
      { todaySpend: 400, unit: 1 },
    );
    expect(over.available).toBe(600);
    expect(over.safeDailyLimit).toBe(200);
    expect(over.overToday).toBe(true);
    expect(over.leftToday).toBe(0);

    const under = planGoals(
      9600,
      [{ amount: 9000, targetDate: '2026-09-30', label: 'Savings' }],
      '2026-09-27',
      { todaySpend: 100, unit: 1 },
    );
    expect(under.safeDailyLimit).toBe(200);
    expect(under.overToday).toBe(false);
    expect(under.leftToday).toBe(100);
  });

  it('marks an unaffordable goal and a zero daily limit', () => {
    const plan = planGoals(1000, [{ amount: 5000, targetDate: '2026-10-02', label: 'Friday' }], '2026-09-27', {
      unit: 1,
    });
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
