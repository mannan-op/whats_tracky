import type { Category } from './types.js';
import { floorToUnit, roundMoney } from './money.js';
import { daysBetween } from './dates.js';

export interface BalanceEvent {
  kind: 'set_funds' | 'add_funds' | 'expense';
  amount: number;
}

export function computeBalance(events: BalanceEvent[]): number {
  let lastSet = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].kind === 'set_funds') lastSet = index;
  }
  const relevant = lastSet === -1 ? events : events.slice(lastSet);
  let balance = 0;
  for (const event of relevant) {
    if (event.kind === 'expense') balance -= event.amount;
    else balance += event.amount;
  }
  return roundMoney(balance);
}

export interface ExpenseView {
  amount: number;
  category: Category;
  note: string;
  localDate: string;
}

export interface CategoryShare {
  category: Category;
  total: number;
  percent: number;
}

export interface Report {
  total: number;
  categories: CategoryShare[];
  top: ExpenseView[];
}

export function percentShares(totals: number[]): number[] {
  const sum = totals.reduce((total, value) => total + value, 0);
  if (sum <= 0) return totals.map(() => 0);
  const raw = totals.map((value) => (value / sum) * 100);
  const floors = raw.map((value) => Math.floor(value));
  let leftover = 100 - floors.reduce((total, value) => total + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const item of order) {
    if (leftover <= 0) break;
    floors[item.index] += 1;
    leftover -= 1;
  }
  return floors;
}

export function buildReport(expenses: ExpenseView[], start: string, end: string): Report {
  const inRange = expenses.filter((expense) => expense.localDate >= start && expense.localDate <= end);
  const totals = new Map<Category, number>();
  for (const expense of inRange) {
    totals.set(expense.category, roundMoney((totals.get(expense.category) ?? 0) + expense.amount));
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const percents = percentShares(sorted.map((entry) => entry[1]));
  const categories = sorted.map(([category, total], index) => ({
    category,
    total,
    percent: percents[index] ?? 0,
  }));
  const top = [...inRange].sort((a, b) => b.amount - a.amount || a.note.localeCompare(b.note)).slice(0, 5);
  const total = roundMoney(inRange.reduce((sum, expense) => sum + expense.amount, 0));
  return { total, categories, top };
}

export function dailyBurn(expenses: Array<{ amount: number; localDate: string }>, today: string, start: string): number {
  const total = expenses
    .filter((expense) => expense.localDate >= start && expense.localDate <= today)
    .reduce((sum, expense) => sum + expense.amount, 0);
  return roundMoney(total / 7);
}

export interface GoalInput {
  amount: number;
  targetDate: string;
  label: string;
}

export interface PlannedGoal {
  amount: number;
  targetDate: string;
  label: string;
  daysUntil: number;
  overdue: boolean;
  dueToday: boolean;
  dailyLimit: number;
  feasible: boolean;
}

export interface GoalPlan {
  reserved: number;
  available: number;
  goals: PlannedGoal[];
  /** Smallest per-goal cap. Null when there is nothing to pace. */
  safeDailyLimit: number | null;
  /** Goal whose cap is the safe daily limit. */
  horizonDate: string | null;
  horizonDays: number | null;
  /** Unused portion of today's cap. Null when there is no cap. */
  leftToday: number | null;
  overToday: boolean;
}

export interface PlanOptions {
  /** Spending already logged today. Compared with the cap; it is not added back into it. */
  todaySpend?: number;
  /** Smallest money step. 1 for whole rupees, 0.01 for cents. */
  unit?: number;
}

const EMPTY_PLAN: Pick<GoalPlan, 'safeDailyLimit' | 'horizonDate' | 'horizonDays' | 'leftToday' | 'overToday'> = {
  safeDailyLimit: null,
  horizonDate: null,
  horizonDays: null,
  leftToday: null,
  overToday: false,
};

/**
 * Safe daily limit.
 *
 * Balance is what you have now (today's spending is already subtracted).
 * A reserve cannot be spent before its date. For each goal, hold back every
 * reserve due on that date or later, divide the rest by the days until then,
 * and round down to `unit`. The safe daily limit is the smallest of those caps.
 * Spending that amount every day leaves each reserve intact until its date.
 * `todaySpend` only decides whether today is already over that same cap.
 */
export function planGoals(balance: number, goals: GoalInput[], today: string, options: PlanOptions = {}): GoalPlan {
  const todaySpend = options.todaySpend ?? 0;
  const unit = options.unit ?? 0.01;
  const reserved = roundMoney(goals.reduce((sum, goal) => sum + goal.amount, 0));
  const available = roundMoney(balance - reserved);
  const planned = goals.map((goal) => {
    const daysUntil = daysBetween(today, goal.targetDate);
    const protectedAmount = roundMoney(
      goals.filter((other) => other.targetDate >= goal.targetDate).reduce((sum, other) => sum + other.amount, 0),
    );
    const spendable = Math.max(0, roundMoney(balance - protectedAmount));
    const days = daysUntil > 0 ? daysUntil : 1;
    return {
      amount: goal.amount,
      targetDate: goal.targetDate,
      label: goal.label,
      daysUntil,
      overdue: daysUntil < 0,
      dueToday: daysUntil === 0,
      dailyLimit: floorToUnit(spendable / days, unit),
      feasible: balance + 0.001 >= goal.amount,
    };
  });

  const pacing = planned.filter((goal) => goal.daysUntil > 0);
  const dueToday = planned.filter((goal) => goal.daysUntil === 0);
  const pool = pacing.length > 0 ? pacing : dueToday;
  if (pool.length === 0) {
    if (planned.length === 0) {
      return { reserved, available, goals: planned, ...EMPTY_PLAN };
    }
    const limit = floorToUnit(Math.max(0, available), unit);
    return finishPlan({ reserved, available, goals: planned, limit, horizonDate: null, horizonDays: null, todaySpend, unit });
  }

  const binding = pool.reduce((best, goal) => {
    if (goal.dailyLimit < best.dailyLimit) return goal;
    if (goal.dailyLimit === best.dailyLimit && goal.daysUntil < best.daysUntil) return goal;
    return best;
  });
  return finishPlan({
    reserved,
    available,
    goals: planned,
    limit: binding.dailyLimit,
    horizonDate: binding.targetDate,
    horizonDays: binding.daysUntil,
    todaySpend,
    unit,
  });
}

function finishPlan(input: {
  reserved: number;
  available: number;
  goals: PlannedGoal[];
  limit: number;
  horizonDate: string | null;
  horizonDays: number | null;
  todaySpend: number;
  unit: number;
}): GoalPlan {
  const overToday = input.todaySpend > input.limit + input.unit / 10;
  const leftToday = overToday ? 0 : floorToUnit(Math.max(0, input.limit - input.todaySpend), input.unit);
  return {
    reserved: input.reserved,
    available: input.available,
    goals: input.goals,
    safeDailyLimit: input.limit,
    horizonDate: input.horizonDate,
    horizonDays: input.horizonDays,
    leftToday,
    overToday,
  };
}
