import { categorize, isCategory } from './categories.js';
import type { AppConfig } from './config.js';
import { isValidYmd } from './dates.js';
import { roundMoney } from './money.js';
import type { Category, Intent, Period } from './types.js';

export interface Llm {
  parse(text: string, today: string): Promise<Intent | null>;
  personalizeAdvice(ruleText: string): Promise<string | null>;
}

const MAX_AMOUNT = 1_000_000_000_000;

function asAmount(value: unknown, allowZero: boolean): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_AMOUNT) return null;
  if (value === 0 && !allowZero) return null;
  return roundMoney(value);
}

function asPeriod(value: unknown): Period | null {
  if (value === 'week' || value === 'month' || value === 'all') return value;
  return null;
}

export function intentFromModel(value: unknown): Intent | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  switch (row.intent) {
    case 'help':
      return { type: 'help' };
    case 'reset':
      return { type: 'reset' };
    case 'confirm':
      return { type: 'confirm' };
    case 'cancel':
      return { type: 'cancel' };
    case 'undo':
      return { type: 'undo' };
    case 'history':
      return { type: 'history' };
    case 'goals':
      return { type: 'goals' };
    case 'advice':
      return { type: 'advice' };
    case 'balance':
      return { type: 'balance' };
    case 'delete_goal': {
      const index = row.goalIndex;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) return null;
      return { type: 'delete_goal', index };
    }
    case 'report': {
      const period = asPeriod(row.period) ?? 'month';
      return { type: 'report', period };
    }
    case 'set_funds': {
      const amount = asAmount(row.amount, true);
      if (amount === null) return null;
      return { type: 'set_funds', amount };
    }
    case 'add_funds': {
      const amount = asAmount(row.amount, false);
      if (amount === null) return null;
      return { type: 'add_funds', amount };
    }
    case 'expense': {
      const amount = asAmount(row.amount, false);
      if (amount === null) return null;
      const note = typeof row.note === 'string' && row.note.trim() ? row.note.trim().slice(0, 200) : 'expense';
      const category: Category = isCategory(row.category) ? row.category : categorize(note);
      return { type: 'expense', amount, note, category };
    }
    case 'save': {
      const amount = asAmount(row.amount, false);
      if (amount === null || typeof row.targetDate !== 'string' || !isValidYmd(row.targetDate)) return null;
      const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim().slice(0, 80) : 'Savings';
      return { type: 'save', amount, targetDate: row.targetDate, label };
    }
    case 'unknown':
      return null;
    default:
      return null;
  }
}

function figures(text: string): string[] {
  return text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
}

export function adviceKeepsFigures(original: string, rewritten: string): boolean {
  const trimmed = rewritten.trim();
  if (!trimmed || trimmed.length > 900) return false;
  return figures(original).every((figure) => trimmed.includes(figure));
}

async function complete(config: AppConfig, system: string, user: string): Promise<string | null> {
  if (!config.openaiApiKey) return null;
  try {
    const response = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return body.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export function createLlm(config: AppConfig): Llm | null {
  if (!config.openaiApiKey) return null;
  return {
    async parse(text: string, today: string): Promise<Intent | null> {
      const content = await complete(
        config,
        [
          'Convert one personal-budget chat message into JSON.',
          `Today is ${today}. Currency is ${config.currency}.`,
          'Return only JSON: {"intent":"set_funds"|"add_funds"|"expense"|"balance"|"report"|"save"|"goals"|"delete_goal"|"undo"|"history"|"advice"|"help"|"reset"|"confirm"|"cancel"|"unknown","amount":number|null,"category":"food"|"transport"|"groceries"|"bills"|"shopping"|"entertainment"|"health"|"other"|null,"note":string|null,"targetDate":"YYYY-MM-DD"|null,"label":string|null,"period":"week"|"month"|"all"|null,"goalIndex":number|null}',
          'Use unknown when it is not a budget command. Do not invent amounts. targetDate must be a real calendar date.',
        ].join('\n'),
        text,
      );
      if (!content) return null;
      try {
        return intentFromModel(JSON.parse(content) as unknown);
      } catch {
        return null;
      }
    },
    async personalizeAdvice(ruleText: string): Promise<string | null> {
      const content = await complete(
        config,
        [
          'Rewrite this budget advice as a short WhatsApp message.',
          'Return JSON: {"text":"..."}',
          'Keep every number and date exactly as given. Do not add facts.',
          'Plain text, short lines, *bold* around amounts, under 700 characters.',
        ].join('\n'),
        ruleText,
      );
      if (!content) return null;
      try {
        const parsed = JSON.parse(content) as { text?: unknown };
        if (typeof parsed.text !== 'string') return null;
        return adviceKeepsFigures(ruleText, parsed.text) ? parsed.text.trim() : null;
      } catch {
        return null;
      }
    },
  };
}
