import type { PlannedGoal } from './calc.js';
import { bold, formatMoney, lines } from './format.js';
import { quantize } from './money.js';

export interface AdviceInput {
  currency: string;
  balance: number;
  available: number;
  todaySpend: number;
  burn7: number;
  safeDailyLimit: number | null;
  horizonLabel: string | null;
  biggest: { categoryLabel: string; total: number; percent: number } | null;
  goals: PlannedGoal[];
  formatDate: (ymd: string) => string;
}

function dayWord(days: number): string {
  return days === 1 ? 'day' : 'days';
}

export function ruleAdvice(input: AdviceInput): string {
  const money = (amount: number) => bold(formatMoney(amount, input.currency));
  const parts: string[] = ['*Advice*', ''];

  if (input.balance === 0 && input.goals.length === 0 && input.burn7 === 0 && input.todaySpend === 0) {
    return lines(
      '*Advice*',
      '',
      'Nothing is logged yet.',
      'Set what you have with `funds 50000`, then send spending like `500 lunch`.',
    );
  }

  const available = quantize(input.available, input.currency);
  const burn = quantize(input.burn7, input.currency);
  parts.push(`Balance ${money(input.balance)} · available ${money(available)}.`);

  if (burn <= 0) {
    parts.push('No spending in the last 7 days, so there is no burn rate yet.');
  } else if (available <= 0) {
    parts.push(
      `7-day burn is ${money(burn)} a day. Available to spend is ${money(available)}, so nothing is left outside your reserves.`,
    );
  } else {
    const runway = Math.floor(available / burn);
    const above =
      input.safeDailyLimit !== null && burn > input.safeDailyLimit
        ? ` That is above the safe daily limit of ${money(input.safeDailyLimit)}.`
        : '';
    parts.push(
      `7-day burn is ${money(burn)} a day. At that pace, available money lasts about ${bold(String(runway))} ${dayWord(runway)}.${above}`,
    );
  }

  if (!input.biggest) {
    parts.push('No spending this month yet.');
  } else {
    parts.push(
      `Biggest this month: ${bold(input.biggest.categoryLabel)} — ${money(input.biggest.total)} (${input.biggest.percent}% of spending).`,
    );
    if (input.biggest.percent >= 40) {
      parts.push(`${input.biggest.categoryLabel} is a large share. Check whether that was planned.`);
    }
  }

  if (input.safeDailyLimit !== null) {
    const until = input.horizonLabel ? ` until ${input.horizonLabel}` : '';
    if (input.todaySpend > input.safeDailyLimit + 0.001) {
      parts.push(
        `Today ${money(input.todaySpend)} is over the safe daily limit of ${money(input.safeDailyLimit)}${until}.`,
      );
    } else {
      parts.push(`Today ${money(input.todaySpend)} is within the safe daily limit of ${money(input.safeDailyLimit)}${until}.`);
    }
  }

  for (const goal of input.goals.slice(0, 4)) {
    const when = input.formatDate(goal.targetDate);
    if (!goal.feasible) {
      const shortfall = Math.max(0, goal.amount - input.balance);
      parts.push(
        `${goal.label}: short ${money(shortfall)} to cover ${money(goal.amount)} by ${when}.`,
      );
    } else if (goal.overdue) {
      parts.push(`${goal.label} was due ${when}. It stays reserved until you delete it.`);
    } else if (goal.dueToday) {
      parts.push(`${goal.label} is due today. Leave ${money(goal.amount)} untouched.`);
    } else {
      parts.push(`${goal.label} is reserved for ${when} (${goal.daysUntil} ${dayWord(goal.daysUntil)}).`);
    }
  }

  return parts.join('\n');
}
