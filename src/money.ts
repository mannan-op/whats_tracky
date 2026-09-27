const MAX_AMOUNT = 1_000_000_000_000;

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** PKR is shown and capped in whole rupees. Other currencies keep cents. */
export function currencyUnit(currency: string): number {
  return currency.trim().toUpperCase() === 'PKR' ? 1 : 0.01;
}

export function quantize(amount: number, currency: string): number {
  const unit = currencyUnit(currency);
  return roundMoney(Math.round((amount + Number.EPSILON) / unit) * unit);
}

export function floorToUnit(amount: number, unit: number): number {
  if (!(unit > 0)) return roundMoney(amount);
  return roundMoney(Math.floor(amount / unit + 1e-8) * unit);
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
