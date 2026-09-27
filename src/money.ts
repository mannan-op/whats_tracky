const MAX_AMOUNT = 1_000_000_000_000;

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function floorMoney(amount: number): number {
  return Math.floor(amount * 100 + 1e-8) / 100;
}

export function parseAmountToken(token: string, options?: { allowZero?: boolean }): number | null {
  const match = token.trim().match(/^(?:rs\.?|pkr|usd|eur|gbp|inr|[$£€])?(\d[\d,]*)(\.\d+)?([kKmM])?$/);
  if (!match) return null;
  const digits = match[1].replace(/,/g, '');
  if (!/^\d+$/.test(digits)) return null;
  let value = Number(digits + (match[2] ?? ''));
  const suffix = match[3]?.toLowerCase();
  if (suffix === 'k') value *= 1_000;
  if (suffix === 'm') value *= 1_000_000;
  if (!Number.isFinite(value) || value > MAX_AMOUNT) return null;
  if (value < 0) return null;
  if (value === 0 && !options?.allowZero) return null;
  return roundMoney(value);
}
