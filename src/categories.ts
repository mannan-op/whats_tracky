import type { Category } from './types.js';

const KEYWORDS: Array<{ category: Category; word: string }> = [
  { category: 'bills', word: 'gas bill' },
  { category: 'bills', word: 'mobile bill' },
  { category: 'food', word: 'breakfast' },
  { category: 'food', word: 'restaurant' },
  { category: 'food', word: 'biryani' },
  { category: 'food', word: 'coffee' },
  { category: 'food', word: 'dinner' },
  { category: 'food', word: 'lunch' },
  { category: 'food', word: 'snack' },
  { category: 'food', word: 'snacks' },
  { category: 'food', word: 'pizza' },
  { category: 'food', word: 'burger' },
  { category: 'food', word: 'juice' },
  { category: 'food', word: 'iftar' },
  { category: 'food', word: 'sehri' },
  { category: 'food', word: 'chai' },
  { category: 'food', word: 'cafe' },
  { category: 'food', word: 'meal' },
  { category: 'food', word: 'food' },
  { category: 'food', word: 'tea' },
  { category: 'transport', word: 'transport' },
  { category: 'transport', word: 'rickshaw' },
  { category: 'transport', word: 'parking' },
  { category: 'transport', word: 'petrol' },
  { category: 'transport', word: 'diesel' },
  { category: 'transport', word: 'careem' },
  { category: 'transport', word: 'train' },
  { category: 'transport', word: 'metro' },
  { category: 'transport', word: 'uber' },
  { category: 'transport', word: 'taxi' },
  { category: 'transport', word: 'fuel' },
  { category: 'transport', word: 'toll' },
  { category: 'transport', word: 'grab' },
  { category: 'transport', word: 'cng' },
  { category: 'transport', word: 'bus' },
  { category: 'transport', word: 'cab' },
  { category: 'transport', word: 'gas' },
  { category: 'transport', word: 'ride' },
  { category: 'groceries', word: 'supermarket' },
  { category: 'groceries', word: 'vegetables' },
  { category: 'groceries', word: 'vegetable' },
  { category: 'groceries', word: 'groceries' },
  { category: 'groceries', word: 'grocery' },
  { category: 'groceries', word: 'fruits' },
  { category: 'groceries', word: 'fruit' },
  { category: 'groceries', word: 'ration' },
  { category: 'groceries', word: 'milk' },
  { category: 'groceries', word: 'mart' },
  { category: 'bills', word: 'electricity' },
  { category: 'bills', word: 'utilities' },
  { category: 'bills', word: 'internet' },
  { category: 'bills', word: 'utility' },
  { category: 'bills', word: 'recharge' },
  { category: 'bills', word: 'electric' },
  { category: 'bills', word: 'bills' },
  { category: 'bills', word: 'rent' },
  { category: 'bills', word: 'wifi' },
  { category: 'bills', word: 'water' },
  { category: 'bills', word: 'bill' },
  { category: 'shopping', word: 'shopping' },
  { category: 'shopping', word: 'clothing' },
  { category: 'shopping', word: 'clothes' },
  { category: 'shopping', word: 'amazon' },
  { category: 'shopping', word: 'daraz' },
  { category: 'shopping', word: 'shirt' },
  { category: 'shopping', word: 'shoes' },
  { category: 'shopping', word: 'mall' },
  { category: 'entertainment', word: 'entertainment' },
  { category: 'entertainment', word: 'concert' },
  { category: 'entertainment', word: 'spotify' },
  { category: 'entertainment', word: 'netflix' },
  { category: 'entertainment', word: 'cinema' },
  { category: 'entertainment', word: 'movie' },
  { category: 'entertainment', word: 'games' },
  { category: 'entertainment', word: 'party' },
  { category: 'entertainment', word: 'game' },
  { category: 'health', word: 'medicines' },
  { category: 'health', word: 'medicine' },
  { category: 'health', word: 'pharmacy' },
  { category: 'health', word: 'hospital' },
  { category: 'health', word: 'medical' },
  { category: 'health', word: 'chemist' },
  { category: 'health', word: 'doctor' },
  { category: 'health', word: 'clinic' },
  { category: 'health', word: 'health' },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function categorize(text: string): Category {
  const haystack = text.toLowerCase();
  let best: { category: Category; length: number } | null = null;
  for (const entry of KEYWORDS) {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.word)}\\b`, 'i');
    if (!pattern.test(haystack)) continue;
    if (!best || entry.word.length > best.length) {
      best = { category: entry.category, length: entry.word.length };
    }
  }
  return best?.category ?? 'other';
}

export function categoryLabel(category: Category): string {
  switch (category) {
    case 'food':
      return 'Food';
    case 'transport':
      return 'Transport';
    case 'groceries':
      return 'Groceries';
    case 'bills':
      return 'Bills';
    case 'shopping':
      return 'Shopping';
    case 'entertainment':
      return 'Entertainment';
    case 'health':
      return 'Health';
    case 'other':
      return 'Other';
    default: {
      const exhaustive: never = category;
      return exhaustive;
    }
  }
}

export function isCategory(value: unknown): value is Category {
  return (
    value === 'food' ||
    value === 'transport' ||
    value === 'groceries' ||
    value === 'bills' ||
    value === 'shopping' ||
    value === 'entertainment' ||
    value === 'health' ||
    value === 'other'
  );
}
