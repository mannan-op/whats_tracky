import { currencyUnit, quantize } from './money.js';

export function formatMoney(amount: number, currency: string): string {
  const rounded = quantize(amount, currency);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const unit = currencyUnit(currency);
  const whole = unit >= 1 || Math.abs(abs - Math.trunc(abs)) < 1e-9;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(abs);
  return `${currency} ${negative ? '-' : ''}${formatted}`;
}

export function bold(text: string): string {
  return `*${text}*`;
}

export function lines(...parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => part !== null && part !== undefined && part !== false).join('\n');
}

export function clipReply(text: string): string {
  if (text.length <= 4000) return text;
  return `${text.slice(0, 3990)}\n…`;
}

export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
