import { ruleAdvice } from './advice.js';
import { buildReport, computeBalance, dailyBurn, planGoals, type GoalPlan } from './calc.js';
import { categoryLabel } from './categories.js';
import type { AppConfig } from './config.js';
import type { Store } from './db.js';
import { addDays, formatPrettyDate, formatStamp, localDate, monthTitle, periodStart } from './dates.js';
import { bold, formatMoney, lines } from './format.js';
import { adviceKeepsFigures, type Llm } from './llm.js';
import type { Category, GoalRow, Intent, LedgerRow, Period } from './types.js';

export interface EngineContext {
  store: Store;
  config: AppConfig;
  now: Date;
  llm: Llm | null;
}

interface Snapshot {
  ledger: LedgerRow[];
  goals: GoalRow[];
  balance: number;
  today: string;
  todaySpend: number;
  plan: GoalPlan;
}

function money(amount: number, currency: string): string {
  return bold(formatMoney(amount, currency));
}

function dayWord(days: number): string {
  return days === 1 ? 'day' : 'days';
}

function takeSnapshot(ctx: EngineContext, userId: string): Snapshot {
  const ledger = ctx.store.listLedger(userId);
  const goals = ctx.store.listGoals(userId);
  const balance = computeBalance(ledger.map((entry) => ({ kind: entry.kind, amount: entry.amount })));
  const today = localDate(ctx.now.toISOString(), ctx.config.tz);
  const todaySpend = ledger
    .filter((entry) => entry.kind === 'expense' && localDate(entry.createdAt, ctx.config.tz) === today)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const plan = planGoals(
    balance,
    goals.map((goal) => ({ amount: goal.amount, targetDate: goal.targetDate, label: goal.label })),
    today,
    todaySpend,
  );
  return { ledger, goals, balance, today, todaySpend, plan };
}

function limitLine(plan: GoalPlan, currency: string, timeZone: string): string | null {
  if (plan.safeDailyLimit === null) return null;
  if (plan.horizonDate && plan.horizonDays !== null && plan.horizonDays > 0) {
    const when = formatPrettyDate(plan.horizonDate, timeZone);
    return `Safe per day until ${when}: ${money(plan.safeDailyLimit, currency)} · ${plan.horizonDays} ${dayWord(plan.horizonDays)}`;
  }
  if (plan.horizonDays === 0) {
    return `A goal is due today. Safe to spend today: ${money(plan.safeDailyLimit, currency)}`;
  }
  return `Safe to spend: ${money(plan.safeDailyLimit, currency)}`;
}

function overLimitLine(snapshot: Snapshot, currency: string): string | null {
  const limit = snapshot.plan.safeDailyLimit;
  if (limit === null || snapshot.todaySpend <= limit + 0.001) return null;
  return `Heads up: today is ${money(snapshot.todaySpend, currency)}, over the safe daily limit of ${money(limit, currency)}.`;
}

function fundsHint(snapshot: Snapshot): string | null {
  const hasFunds = snapshot.ledger.some((entry) => entry.kind === 'set_funds' || entry.kind === 'add_funds');
  if (!hasFunds) return 'Set what you have with `funds 50000`.';
  return null;
}

function balanceBlock(snapshot: Snapshot, currency: string, timeZone: string): string {
  const parts = [`Left: ${money(snapshot.balance, currency)}`];
  if (snapshot.goals.length > 0) {
    parts.push(
      `Available: ${money(snapshot.plan.available, currency)} (reserved ${money(snapshot.plan.reserved, currency)})`,
    );
    const limit = limitLine(snapshot.plan, currency, timeZone);
    if (limit) parts.push(limit);
  }
  const warn = overLimitLine(snapshot, currency);
  if (warn) parts.push(warn);
  const hint = fundsHint(snapshot);
  if (hint) parts.push(hint);
  return parts.join('\n');
}

function helpText(currency: string): string {
  return [
    '*Budget bot*',
    '',
    'Set money:',
    '· funds 50000',
    '· add funds 10000',
    '',
    'Log spending:',
    '· 500 food lunch',
    '· spent 1200 on petrol',
    '· groceries 3400',
    '',
    'Check:',
    '· balance',
    '· report',
    '· summary week',
    '',
    'Save for a date:',
    '· save 5000 for Friday',
    '· save 3000 for 15 Oct wedding',
    '',
    'Also: goals, delete goal 1, undo, history, advice, reset',
    '',
    `Amounts use ${currency}.`,
  ].join('\n');
}

function unknownReply(text: string): string {
  if (/^(?:save|reserve|set aside|put aside)\b/i.test(text)) {
    return lines(
      "I couldn't read that date.",
      'Try `save 5000 for Friday` or `save 3000 for 15 Oct wedding`.',
    );
  }
  const amounts = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  if (amounts.length > 1) return 'Send one expense at a time, like `500 lunch`.';
  return lines("I didn't catch that.", 'Try `500 food lunch`, `balance`, or `help`.');
}

function reportTitle(period: Period, today: string, timeZone: string): string {
  if (period === 'week') return 'Last 7 days';
  if (period === 'all') return 'All time';
  return monthTitle(today, timeZone);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled intent ${JSON.stringify(value)}`);
}

function readId(payload: string): number | null {
  try {
    const parsed = JSON.parse(payload) as { id?: unknown };
    return typeof parsed.id === 'number' && Number.isInteger(parsed.id) ? parsed.id : null;
  } catch {
    return null;
  }
}

function readGoalPayload(payload: string): { id: number; amount: number; targetDate: string; label: string } | null {
  try {
    const parsed = JSON.parse(payload) as { id?: unknown; amount?: unknown; targetDate?: unknown; label?: unknown };
    if (
      typeof parsed.id !== 'number' ||
      typeof parsed.amount !== 'number' ||
      typeof parsed.targetDate !== 'string' ||
      typeof parsed.label !== 'string'
    ) {
      return null;
    }
    return { id: parsed.id, amount: parsed.amount, targetDate: parsed.targetDate, label: parsed.label };
  } catch {
    return null;
  }
}

export async function dispatch(userId: string, intent: Intent, ctx: EngineContext): Promise<string> {
  const { store, config } = ctx;
  const nowIso = ctx.now.toISOString();
  store.ensureUser(userId, nowIso);
  const currency = config.currency;

  if (store.isPendingReset(userId) && intent.type !== 'confirm' && intent.type !== 'cancel' && intent.type !== 'reset') {
    store.setPendingReset(userId, false);
  }

  switch (intent.type) {
    case 'help':
      return helpText(currency);
    case 'reset':
      store.setPendingReset(userId, true);
      return lines('This deletes your funds, expenses, and goals.', `Reply ${bold('YES')} to confirm.`);
    case 'confirm':
      if (!store.isPendingReset(userId)) return 'Nothing is waiting for confirmation.';
      store.clearUser(userId);
      return 'All cleared. Send `funds 50000` when you want to start again.';
    case 'cancel':
      if (!store.isPendingReset(userId)) return 'Nothing to cancel.';
      store.setPendingReset(userId, false);
      return 'Reset cancelled. Your budget is unchanged.';
    case 'undo':
      return undo(userId, ctx);
    case 'history':
      return history(userId, ctx);
    case 'goals':
      return goalsReply(takeSnapshot(ctx, userId), currency, config.tz);
    case 'delete_goal':
      return deleteGoal(userId, intent.index, ctx);
    case 'advice':
      return advise(userId, ctx);
    case 'balance':
      return balanceReply(takeSnapshot(ctx, userId), currency, config.tz);
    case 'report':
      return reportReply(userId, intent.period, ctx);
    case 'set_funds':
      return mutateFunds(userId, 'set_funds', intent.amount, ctx);
    case 'add_funds':
      return mutateFunds(userId, 'add_funds', intent.amount, ctx);
    case 'expense':
      return addExpense(userId, intent.amount, intent.note, intent.category, ctx);
    case 'save':
      return addGoal(userId, intent.amount, intent.targetDate, intent.label, ctx);
    case 'unknown':
      return unknownReply(intent.text);
    default:
      return assertNever(intent);
  }
}

function mutateFunds(userId: string, kind: 'set_funds' | 'add_funds', amount: number, ctx: EngineContext): string {
  const nowIso = ctx.now.toISOString();
  ctx.store.transaction(() => {
    const row = ctx.store.insertLedger({
      userId,
      kind,
      amount,
      category: null,
      note: null,
      createdAt: nowIso,
    });
    ctx.store.pushUndo(userId, 'delete_ledger', { id: row.id }, nowIso);
  });
  const snapshot = takeSnapshot(ctx, userId);
  if (kind === 'set_funds') {
    return lines(`Funds set to ${money(amount, ctx.config.currency)}.`, 'That is your balance now.');
  }
  return lines(
    `Added ${money(amount, ctx.config.currency)}.`,
    `Balance: ${money(snapshot.balance, ctx.config.currency)}.`,
  );
}

function addExpense(userId: string, amount: number, note: string, category: Category, ctx: EngineContext): string {
  const nowIso = ctx.now.toISOString();
  ctx.store.transaction(() => {
    const row = ctx.store.insertLedger({
      userId,
      kind: 'expense',
      amount,
      category,
      note,
      createdAt: nowIso,
    });
    ctx.store.pushUndo(userId, 'delete_ledger', { id: row.id }, nowIso);
  });
  const snapshot = takeSnapshot(ctx, userId);
  return lines(
    `Logged ${money(amount, ctx.config.currency)} · ${categoryLabel(category)}`,
    note,
    '',
    balanceBlock(snapshot, ctx.config.currency, ctx.config.tz),
  );
}

function addGoal(userId: string, amount: number, targetDate: string, label: string, ctx: EngineContext): string {
  const nowIso = ctx.now.toISOString();
  ctx.store.transaction(() => {
    const row = ctx.store.insertGoal({
      userId,
      amount,
      targetDate,
      label,
      createdAt: nowIso,
    });
    ctx.store.pushUndo(userId, 'delete_goal', { id: row.id }, nowIso);
  });
  const snapshot = takeSnapshot(ctx, userId);
  const planned = snapshot.plan.goals.find((goal) => goal.targetDate === targetDate && goal.label === label);
  const when = formatPrettyDate(targetDate, ctx.config.tz);
  const currency = ctx.config.currency;
  const days = planned?.daysUntil ?? 0;
  const parts = [`Set aside ${money(amount, currency)} for ${when}.`, ''];
  parts.push(`Balance: ${money(snapshot.balance, currency)}`);
  parts.push(`Reserved: ${money(snapshot.plan.reserved, currency)}`);
  parts.push(`Available to spend: ${money(snapshot.plan.available, currency)}`);
  if (snapshot.plan.available < -0.001) {
    parts.push(
      `You're short ${money(Math.abs(snapshot.plan.available), currency)} to cover every reserve. Add funds or lower a goal.`,
    );
  } else if (days < 0) {
    parts.push(`That date has already passed. It stays reserved until you delete it.`);
  } else if (days === 0) {
    parts.push(`Due today. Leave ${money(amount, currency)} untouched.`);
  } else {
    const daily = planned?.dailyLimit ?? 0;
    parts.push(
      `${days} ${dayWord(days)} to go. Keep daily spending around ${money(daily, currency)} and this reserve stays untouched.`,
    );
  }
  const warn = overLimitLine(snapshot, currency);
  if (warn) parts.push(warn);
  return parts.join('\n');
}

function goalsReply(snapshot: Snapshot, currency: string, timeZone: string): string {
  if (snapshot.goals.length === 0) {
    return 'No savings goals. Try `save 5000 for Friday`.';
  }
  const rows = snapshot.plan.goals.map((goal, index) => {
    const when = formatPrettyDate(goal.targetDate, timeZone);
    const whenText = goal.overdue ? `${when} (overdue)` : goal.dueToday ? `${when} (today)` : `${when} (${goal.daysUntil} ${dayWord(goal.daysUntil)})`;
    return `${index + 1}. ${goal.label} — ${money(goal.amount, currency)} — ${whenText} · daily ${money(goal.dailyLimit, currency)}`;
  });
  return lines(
    '*Goals*',
    '',
    ...rows,
    '',
    `Reserved ${money(snapshot.plan.reserved, currency)} · available ${money(snapshot.plan.available, currency)}`,
  );
}

function deleteGoal(userId: string, index: number, ctx: EngineContext): string {
  const goals = ctx.store.listGoals(userId);
  const goal = goals[index - 1];
  if (!goal) {
    return goals.length === 0
      ? 'No goals to delete.'
      : `No goal ${index}. Send \`goals\` to see the list.`;
  }
  const nowIso = ctx.now.toISOString();
  ctx.store.transaction(() => {
    ctx.store.deleteGoal(goal.id, userId);
    ctx.store.pushUndo(
      userId,
      'insert_goal',
      { id: goal.id, amount: goal.amount, targetDate: goal.targetDate, label: goal.label },
      nowIso,
    );
  });
  return `Removed goal ${index} (${goal.label}, ${money(goal.amount, ctx.config.currency)}).`;
}

function balanceReply(snapshot: Snapshot, currency: string, timeZone: string): string {
  const parts = [`Balance: ${money(snapshot.balance, currency)}`];
  if (snapshot.goals.length > 0) {
    parts.push(`Reserved: ${money(snapshot.plan.reserved, currency)}`);
    parts.push(`Available to spend: ${money(snapshot.plan.available, currency)}`);
    const limit = limitLine(snapshot.plan, currency, timeZone);
    if (limit) parts.push(limit);
  }
  if (snapshot.todaySpend > 0 || snapshot.plan.safeDailyLimit !== null) {
    parts.push(`Today spent: ${money(snapshot.todaySpend, currency)}`);
  }
  const warn = overLimitLine(snapshot, currency);
  if (warn) parts.push(warn);
  const hint = fundsHint(snapshot);
  if (hint && snapshot.ledger.length === 0) parts.push(hint);
  return parts.join('\n');
}

function reportReply(userId: string, period: Period, ctx: EngineContext): string {
  const snapshot = takeSnapshot(ctx, userId);
  const start = periodStart(period, snapshot.today);
  const end = period === 'all' ? '9999-12-31' : snapshot.today;
  const expenses = snapshot.ledger
    .filter((entry) => entry.kind === 'expense')
    .map((entry) => ({
      amount: entry.amount,
      category: entry.category ?? 'other',
      note: entry.note ?? 'expense',
      localDate: localDate(entry.createdAt, ctx.config.tz),
    }));
  const report = buildReport(expenses, start, end);
  const title = reportTitle(period, snapshot.today, ctx.config.tz);
  if (report.total === 0) {
    if (period === 'week') return 'No spending in the last 7 days.';
    if (period === 'all') return 'No spending yet.';
    return `No spending in ${title}.`;
  }
  const currency = ctx.config.currency;
  const categoryLines = report.categories.map(
    (category) =>
      `${categoryLabel(category.category)} — ${money(category.total, currency)} (${category.percent}%)`,
  );
  const topLines = report.top.map((item) => {
    const label = categoryLabel(item.category);
    const suffix = item.note.toLowerCase() === label.toLowerCase() ? '' : ` · ${label}`;
    return `· ${money(item.amount, currency)} ${item.note}${suffix}`;
  });
  return lines(`*${title}*`, `Total ${money(report.total, currency)}`, '', ...categoryLines, '', 'Top:', ...topLines);
}

async function advise(userId: string, ctx: EngineContext): Promise<string> {
  const snapshot = takeSnapshot(ctx, userId);
  const start = addDays(snapshot.today, -6);
  const monthStart = periodStart('month', snapshot.today);
  const expenses = snapshot.ledger
    .filter((entry) => entry.kind === 'expense')
    .map((entry) => ({
      amount: entry.amount,
      category: entry.category ?? 'other',
      note: entry.note ?? 'expense',
      localDate: localDate(entry.createdAt, ctx.config.tz),
    }));
  const burn7 = dailyBurn(expenses, snapshot.today, start);
  const month = buildReport(expenses, monthStart, snapshot.today);
  const biggest = month.categories[0];
  const text = ruleAdvice({
    currency: ctx.config.currency,
    balance: snapshot.balance,
    available: snapshot.plan.available,
    todaySpend: snapshot.todaySpend,
    burn7,
    safeDailyLimit: snapshot.plan.safeDailyLimit,
    horizonLabel:
      snapshot.plan.horizonDate && snapshot.plan.horizonDays !== null && snapshot.plan.horizonDays > 0
        ? formatPrettyDate(snapshot.plan.horizonDate, ctx.config.tz)
        : null,
    biggest: biggest
      ? { categoryLabel: categoryLabel(biggest.category), total: biggest.total, percent: biggest.percent }
      : null,
    goals: snapshot.plan.goals,
    formatDate: (ymd) => formatPrettyDate(ymd, ctx.config.tz),
  });
  if (!ctx.llm) return text;
  const personalized = await ctx.llm.personalizeAdvice(text);
  if (personalized && adviceKeepsFigures(text, personalized)) return personalized;
  return text;
}

function history(userId: string, ctx: EngineContext): string {
  const ledger = ctx.store.listLedger(userId);
  if (ledger.length === 0) return 'No history yet. Try `funds 50000` or `500 lunch`.';
  const recent = [...ledger].reverse().slice(0, 10);
  const rows = recent.map((entry, index) => {
    const when = formatStamp(entry.createdAt, ctx.config.tz);
    if (entry.kind === 'expense') {
      return `${index + 1}. ${categoryLabel(entry.category ?? 'other')} · ${formatMoney(entry.amount, ctx.config.currency)} · ${entry.note ?? 'expense'} · ${when}`;
    }
    const verb = entry.kind === 'set_funds' ? 'Set funds' : 'Added funds';
    return `${index + 1}. ${verb} · ${formatMoney(entry.amount, ctx.config.currency)} · ${when}`;
  });
  return lines('*Recent*', '', ...rows);
}

function undo(userId: string, ctx: EngineContext): string {
  const record = ctx.store.popUndo(userId);
  if (!record) return 'Nothing to undo.';
  const currency = ctx.config.currency;
  switch (record.op) {
    case 'delete_ledger': {
      const id = readId(record.payload);
      const row = id === null ? null : ctx.store.deleteLedger(id, userId);
      if (!row) return 'Nothing to undo.';
      const snapshot = takeSnapshot(ctx, userId);
      const what =
        row.kind === 'expense'
          ? `Undid ${categoryLabel(row.category ?? 'other')} ${money(row.amount, currency)} (${row.note ?? 'expense'}).`
          : row.kind === 'set_funds'
            ? `Undid setting funds to ${money(row.amount, currency)}.`
            : `Undid adding ${money(row.amount, currency)}.`;
      return lines(what, `Balance: ${money(snapshot.balance, currency)}.`);
    }
    case 'delete_goal': {
      const id = readId(record.payload);
      const row = id === null ? null : ctx.store.deleteGoal(id, userId);
      if (!row) return 'Nothing to undo.';
      return `Undid saving ${money(row.amount, currency)} for ${row.label}.`;
    }
    case 'insert_goal': {
      const goal = readGoalPayload(record.payload);
      if (!goal) return 'Nothing to undo.';
      ctx.store.insertGoal({
        id: goal.id,
        userId,
        amount: goal.amount,
        targetDate: goal.targetDate,
        label: goal.label,
        createdAt: ctx.now.toISOString(),
      });
      return `Restored goal ${goal.label} (${money(goal.amount, currency)}).`;
    }
    default: {
      const exhaustive: never = record.op;
      return exhaustive;
    }
  }
}
