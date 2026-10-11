import { getLocale, t } from './i18n';

export { formatBytes } from '../../shared/text';

// Formatter theo ngôn ngữ đang chọn (tạo lại khi đổi ngôn ngữ).
let cached: { locale: string; dateTime: Intl.DateTimeFormat; dateOnly: Intl.DateTimeFormat; relative: Intl.RelativeTimeFormat } | null = null;
function fmt() {
  const locale = getLocale();
  if (cached?.locale !== locale) {
    cached = {
      locale,
      dateTime: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }),
      dateOnly: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      relative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
    };
  }
  return cached;
}

export function formatDateTime(ts: number | null | undefined): string {
  return ts ? fmt().dateTime.format(ts) : '—';
}

export function formatDate(ts: number | null | undefined): string {
  return ts ? fmt().dateOnly.format(ts) : '—';
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const relative = fmt().relative;
  if (abs < 45) return t('vừa xong');
  if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return relative.format(Math.round(diff / 86400), 'day');
  return formatDate(ts);
}

/** "2026-10-10T08:30" cho <input type="datetime-local"> theo giờ máy. */
export function toLocalInput(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond) return '';
  const mb = bytesPerSecond / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
