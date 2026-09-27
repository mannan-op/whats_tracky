import { describe, expect, it } from 'vitest';
import { adviceKeepsFigures, intentFromModel } from '../src/llm.js';
import { ruleAdvice } from '../src/advice.js';

describe('intentFromModel', () => {
  it('accepts a valid expense and rejects invented shapes', () => {
    expect(
      intentFromModel({
        intent: 'expense',
        amount: 1200,
        note: 'petrol',
        category: 'transport',
      }),
    ).toEqual({ type: 'expense', amount: 1200, note: 'petrol', category: 'transport' });

    expect(intentFromModel({ intent: 'save', amount: 10, targetDate: '2026-02-31', label: 'x' })).toBeNull();
    expect(intentFromModel({ intent: 'set_funds', amount: -5 })).toBeNull();
    expect(intentFromModel({ intent: 'unknown' })).toBeNull();
    expect(intentFromModel({ intent: 'delete_goal', goalIndex: 2 })).toEqual({ type: 'delete_goal', index: 2 });
  });
});

describe('advice figures', () => {
  it('keeps every number from the rule-based advice', () => {
    const text = ruleAdvice({
      currency: 'PKR',
      balance: 1000,
      available: 700,
      todaySpend: 300,
      burn7: 100,
      safeDailyLimit: 140,
      horizonLabel: 'Fri, 2 Oct',
      biggest: { categoryLabel: 'Food', total: 300, percent: 100 },
      goals: [
        {
          amount: 300,
          targetDate: '2026-10-02',
          label: 'Friday',
          daysUntil: 5,
          overdue: false,
          dueToday: false,
          dailyLimit: 140,
          feasible: true,
        },
      ],
      formatDate: () => 'Fri, 2 Oct',
    });
    expect(text).toContain('7-day burn');
    expect(text).toContain('Food');
    expect(text).toContain('over the safe daily limit');
    expect(adviceKeepsFigures(text, text)).toBe(true);
    expect(adviceKeepsFigures(text, 'Spend less.')).toBe(false);
  });
});
