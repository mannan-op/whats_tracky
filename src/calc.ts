import type { Category } from './types.js';
import { floorMoney, roundMoney } from './money.js';
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
  safeDailyLimit: number | null;
  horizonDate: string | null;
  horizonDays: number | null;
}

export function planGoals(balance: number, goals: GoalInput[], today: string, todaySpend = 0): GoalPlan {
  const reserved = roundMoney(goals.reduce((sum, goal) => sum + goal.amount, 0));
  const available = roundMoney(balance - reserved);
  // Today's expenses are already out of the balance. Add them back so the daily
  // limit stays the full day's budget and does not shrink after each expense.
  const spendable = Math.max(0, roundMoney(available + todaySpend));
  const planned = goals.map((goal) => {
    const daysUntil = daysBetween(today, goal.targetDate);
    const divisor = daysUntil > 0 ? daysUntil : 1;
    return {
      amount: goal.amount,
      targetDate: goal.targetDate,
      label: goal.label,
      daysUntil,
      overdue: daysUntil < 0,
      dueToday: daysUntil === 0,
      dailyLimit: floorMoney(spendable / divisor),
      feasible: balance + 0.001 >= goal.amount,
    };
  });

  if (planned.length === 0) {
    return {
      reserved,
      available,
      goals: planned,
      safeDailyLimit: null,
      horizonDate: null,
      horizonDays: null,
    };
  }

  const upcoming = planned.filter((goal) => goal.daysUntil >= 0);
  if (upcoming.length === 0) {
    return {
      reserved,
      available,
      goals: planned,
      safeDailyLimit: floorMoney(spendable),
      horizonDate: null,
      horizonDays: null,
    };
  }

  const nearest = upcoming.reduce((best, goal) => (goal.daysUntil < best.daysUntil ? goal : best));
  const divisor = nearest.daysUntil > 0 ? nearest.daysUntil : 1;
  return {
    reserved,
    available,
    goals: planned,
    safeDailyLimit: floorMoney(spendable / divisor),
    horizonDate: nearest.targetDate,
    horizonDays: nearest.daysUntil,
  };
}
