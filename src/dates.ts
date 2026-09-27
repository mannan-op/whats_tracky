const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export function safeTimeZone(timeZone: string): string {
  try {
    Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function formatYmd(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error(`Could not format a date in timezone ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}

export function localDate(iso: string, timeZone: string): string {
  return formatYmd(new Date(iso), timeZone);
}

export function isValidYmd(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return partsMatch(year, month, day);
}

function partsMatch(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(ymdValue: string, days: number): string {
  const [year, month, day] = ymdValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export function weekdayIndex(ymdValue: string): number {
  const [year, month, day] = ymdValue.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function upcomingWeekday(today: string, weekday: number, nextWeek: boolean): string {
  const todayIndex = weekdayIndex(today);
  let delta = (weekday - todayIndex + 7) % 7;
  if (nextWeek) delta = delta === 0 ? 7 : delta + 7;
  return addDays(today, delta);
}

export function periodStart(period: 'week' | 'month' | 'all', today: string): string {
  if (period === 'all') return '0000-01-01';
  if (period === 'week') return addDays(today, -6);
  return `${today.slice(0, 8)}01`;
}

export function formatPrettyDate(ymdValue: string, timeZone: string): string {
  const [year, month, day] = ymdValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function formatStamp(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${day}, ${time}`;
}

export function monthTitle(today: string, timeZone: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function resolveMonthDay(day: number, month: number, year: number | null, today: string): string | null {
  const fallbackYear = Number(today.slice(0, 4));
  const chosenYear = year ?? fallbackYear;
  if (!partsMatch(chosenYear, month, day)) return null;
  const date = ymd(chosenYear, month, day);
  if (year !== null || date >= today) return date;
  const next = ymd(chosenYear + 1, month, day);
  return partsMatch(chosenYear + 1, month, day) ? next : null;
}

function dmyToYmd(first: number, second: number, year: number): string | null {
  if (partsMatch(year, second, first)) return ymd(year, second, first);
  if (partsMatch(year, first, second)) return ymd(year, first, second);
  return null;
}

export interface ParsedDate {
  date: string;
  label: string;
}

function cleanLabel(raw: string | undefined, fallback: string): string {
  const label = (raw ?? '').trim().replace(/\s+/g, ' ');
  return (label || fallback).slice(0, 80);
}

export function parseDateAndLabel(phrase: string, today: string): ParsedDate | null {
  const text = phrase.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!text) return null;

  let match = /^(\d{4}-\d{2}-\d{2})(?:\s+(.*))?$/.exec(text);
  if (match && isValidYmd(match[1])) {
    return { date: match[1], label: cleanLabel(match[2], 'Savings') };
  }

  match = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:\s+(.*))?$/.exec(text);
  if (match) {
    const date = dmyToYmd(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!date) return null;
    return { date, label: cleanLabel(match[4], 'Savings') };
  }

  match = /^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([A-Za-z]+)(?:\s+(\d{4}))?(?:\s+(.*))?$/i.exec(text);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    if (!month) return null;
    const date = resolveMonthDay(Number(match[1]), month, match[3] ? Number(match[3]) : null, today);
    if (!date) return null;
    return { date, label: cleanLabel(match[4], 'Savings') };
  }

  match = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?(?:\s+(.*))?$/i.exec(text);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month) {
      const date = resolveMonthDay(Number(match[2]), month, match[3] ? Number(match[3]) : null, today);
      if (!date) return null;
      return { date, label: cleanLabel(match[4], 'Savings') };
    }
  }

  match = /^(today|tomorrow)(?:\s+(.*))?$/i.exec(text);
  if (match) {
    const date = match[1].toLowerCase() === 'today' ? today : addDays(today, 1);
    const fallback = match[1].toLowerCase() === 'today' ? 'Today' : 'Tomorrow';
    return { date, label: cleanLabel(match[2], fallback) };
  }

  match = /^(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(.*))?$/i.exec(text);
  if (match) {
    const weekday = WEEKDAYS.indexOf(match[2].toLowerCase() as (typeof WEEKDAYS)[number]);
    const date = upcomingWeekday(today, weekday, match[1]?.toLowerCase() === 'next');
    const fallback = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
    return { date, label: cleanLabel(match[3], fallback) };
  }

  return null;
}
