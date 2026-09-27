export const CATEGORIES = [
  'food',
  'transport',
  'groceries',
  'bills',
  'shopping',
  'entertainment',
  'health',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Period = 'week' | 'month' | 'all';

export type LedgerKind = 'set_funds' | 'add_funds' | 'expense';

export type Intent =
  | { type: 'help' }
  | { type: 'reset' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'undo' }
  | { type: 'history' }
  | { type: 'goals' }
  | { type: 'delete_goal'; index: number }
  | { type: 'advice' }
  | { type: 'balance' }
  | { type: 'report'; period: Period }
  | { type: 'set_funds'; amount: number }
  | { type: 'add_funds'; amount: number }
  | { type: 'expense'; amount: number; note: string; category: Category }
  | { type: 'save'; amount: number; targetDate: string; label: string }
  | { type: 'unknown'; text: string };

export interface LedgerRow {
  id: number;
  userId: string;
  kind: LedgerKind;
  amount: number;
  category: Category | null;
  note: string | null;
  createdAt: string;
}

export interface GoalRow {
  id: number;
  userId: string;
  amount: number;
  targetDate: string;
  label: string;
  createdAt: string;
}

export type UndoOp = 'delete_ledger' | 'delete_goal' | 'insert_goal';

export interface UndoEntry {
  id: number;
  op: UndoOp;
  payload: string;
}
