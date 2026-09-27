import { roundMoney } from './money.js';

export function formatMoney(amount: number, currency: string): string {
  const rounded = roundMoney(amount);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const cents = Math.round(abs * 100) % 100;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: cents === 0 ? 0 : 2,
    maximumFractionDigits: 2,
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
