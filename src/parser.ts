import { categorize } from './categories.js';
import { parseDateAndLabel } from './dates.js';
import { parseAmountToken } from './money.js';
import type { Category, Intent, Period } from './types.js';

const CURRENCY_WORD = String.raw`(?:rs\.?|pkr|usd|eur|gbp|inr|[$£€])`;
const FILLER = new Set(['spent', 'spend', 'paid', 'pay', 'bought', 'buy', 'add', 'on', 'for']);
const CURRENCY_TOKENS = new Set(['rs', 'rs.', 'pkr', 'usd', 'eur', 'gbp', 'inr', '$', '£', '€']);

export interface ParseContext {
  today: string;
}

function normalize(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/g, '')
    .trim();
}

function periodFrom(word: string | undefined): Period {
  const value = word?.toLowerCase();
  if (value === 'week' || value === 'weekly') return 'week';
  if (value === 'all' || value === 'everything') return 'all';
  return 'month';
}

function trySave(raw: string, today: string): Intent | 'invalid' | null {
  if (!/^(?:save|reserve|set aside|put aside)\b/i.test(raw)) return null;
  const pattern = new RegExp(
    `^(?:save|reserve|set aside|put aside)\\s+(?:${CURRENCY_WORD}\\s+)?(\\S+)\\s+(?:for|by|until|till|on)\\s+(.+)$`,
    'i',
  );
  const found = pattern.exec(raw);
  if (!found) return 'invalid';
  const amount = parseAmountToken(found[1]);
  if (amount === null) return 'invalid';
  const parsed = parseDateAndLabel(found[2], today);
  if (!parsed) return 'invalid';
  return { type: 'save', amount, targetDate: parsed.date, label: parsed.label };
}

function tryFunds(raw: string): Intent | 'invalid' | null {
  const looksLikeFunds =
    /^(?:set\s+)?(?:my\s+)?funds?\b/i.test(raw) || /^add\s+\S+\s+(?:to\s+)?funds?$/i.test(raw) || /^add\s+funds?\b/i.test(raw);
  if (!looksLikeFunds) return null;
  if (/^funds?$/i.test(raw)) return null;

  const addPattern = new RegExp(
    `^(?:add\\s+funds?\\s+(?:${CURRENCY_WORD}\\s+)?(\\S+)|add\\s+(?:${CURRENCY_WORD}\\s+)?(\\S+)\\s+(?:to\\s+)?funds?)$`,
    'i',
  );
  const added = addPattern.exec(raw);
  if (added) {
    const token = added[1] ?? added[2];
    const amount = parseAmountToken(token);
    return amount === null ? 'invalid' : { type: 'add_funds', amount };
  }

  const setPattern = new RegExp(
    `^(?:set\\s+)?(?:my\\s+)?funds?\\s+(?:to\\s+|is\\s+|are\\s+)?(?:${CURRENCY_WORD}\\s+)?(\\S+)$`,
    'i',
  );
  const set = setPattern.exec(raw);
  if (!set) return 'invalid';
  const amount = parseAmountToken(set[1], { allowZero: true });
  return amount === null ? 'invalid' : { type: 'set_funds', amount };
}

interface AmountHit {
  amount: number;
  index: number;
}

function amountToken(token: string): string {
  const unsigned = token.replace(/^[+]/, '').replace(/^-/, '').replace(/[.,!?]+$/g, '');
  return unsigned;
}

function findAmounts(tokens: string[]): AmountHit[] {
  const hits: AmountHit[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const amount = parseAmountToken(amountToken(tokens[index]));
    if (amount !== null) hits.push({ amount, index });
  }
  return hits;
}

function noteFrom(tokens: string[], amountIndex: number): string {
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (index === amountIndex) continue;
    const token = tokens[index];
    if (CURRENCY_TOKENS.has(token.toLowerCase())) continue;
    kept.push(token);
  }
  while (kept.length > 0 && FILLER.has(kept[0].toLowerCase())) kept.shift();
  const note = kept.join(' ').trim();
  return (note || 'expense').slice(0, 200);
}

function tryExpense(raw: string): Intent | 'invalid' | null {
  const tokens = raw.split(' ').filter(Boolean);
  const hits = findAmounts(tokens);
  if (hits.length === 0) return null;
  if (hits.length > 1) return 'invalid';
  const hit = hits[0];
  const rawNote = noteFrom(tokens, hit.index);
  const category = categorize(rawNote);
  return {
    type: 'expense',
    amount: hit.amount,
    note: tidyNote(rawNote, category),
    category,
  };
}

function tidyNote(note: string, category: Category): string {
  if (category === 'other') return note;
  const tokens = note.split(' ');
  if (tokens.length < 2) return note;
  const rest = tokens.slice(1).join(' ');
  if (categorize(tokens[0]) !== category) return note;
  return rest;
}

export function parseMessage(text: string, ctx: ParseContext): Intent {
  const raw = normalize(text);
  if (!raw) return { type: 'unknown', text: '' };
  const lower = raw.toLowerCase();

  if (lower === 'help' || lower === '?' || lower === 'commands') return { type: 'help' };
  if (lower === 'reset') return { type: 'reset' };
  if (lower === 'yes' || lower === 'y' || lower === 'confirm') return { type: 'confirm' };
  if (lower === 'no' || lower === 'n' || lower === 'cancel') return { type: 'cancel' };
  if (lower === 'undo' || lower === 'undo last') return { type: 'undo' };
  if (lower === 'history' || lower === 'recent' || lower === 'transactions') return { type: 'history' };
  if (lower === 'goals' || lower === 'my goals' || lower === 'savings' || lower === 'my savings') {
    return { type: 'goals' };
  }
  if (lower === 'advice' || lower === 'tips' || lower === 'tip') return { type: 'advice' };

  const deleteGoal = /^(?:delete|remove)\s+goal\s+#?(\d+)$/i.exec(raw);
  if (deleteGoal) {
    const index = Number(deleteGoal[1]);
    if (!Number.isInteger(index) || index < 1) return { type: 'unknown', text: raw };
    return { type: 'delete_goal', index };
  }

  if (
    /^(?:balance|left|remaining|status|funds?)$/i.test(raw) ||
    /^how much(?:\s+is|\s+do i have)?\s+left$/i.test(raw) ||
    /^how much do i have$/i.test(raw) ||
    /^what(?:'s| is) left$/i.test(raw) ||
    /^what(?:'s| is) my balance$/i.test(raw)
  ) {
    return { type: 'balance' };
  }

  const report = /^(?:report|summary|stats)(?:\s+(?:this\s+)?)?(week|weekly|month|monthly|all|everything)?$/i.exec(raw);
  if (report) return { type: 'report', period: periodFrom(report[1]) };

  const where = /^where did i spend(?:\s+(?:this\s+)?)?(week|weekly|month|monthly)?$/i.exec(raw);
  if (where) return { type: 'report', period: periodFrom(where[1]) };
  if (/^where did i spend\b/i.test(raw)) return { type: 'report', period: 'month' };

  const saved = trySave(raw, ctx.today);
  if (saved) return saved === 'invalid' ? { type: 'unknown', text: raw } : saved;

  const funds = tryFunds(raw);
  if (funds) return funds === 'invalid' ? { type: 'unknown', text: raw } : funds;

  const expense = tryExpense(raw);
  if (expense === 'invalid') return { type: 'unknown', text: raw };
  if (expense) return expense;

  return { type: 'unknown', text: raw };
}
