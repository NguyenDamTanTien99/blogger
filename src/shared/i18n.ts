import { EN } from './i18n-en';

export const LANGS = ['vi', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export type Vars = Record<string, string | number>;

/**
 * Câu tiếng Việt chính là "khóa" dịch: code viết t('Ghi chú') và từ điển EN ánh xạ sang 'Notes'.
 * Thiếu bản dịch thì giữ nguyên tiếng Việt (không bao giờ hiện khóa kỹ thuật). Biến dạng {ten}.
 */
export function translate(lang: Lang, text: string, vars?: Vars): string {
  const template = lang === 'en' ? (EN[text] ?? text) : text;
  return vars ? template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m)) : template;
}

export function normalizeLang(value: string | null | undefined): Lang {
  return value?.toLowerCase().startsWith('en') ? 'en' : 'vi';
}

/** Locale cho Intl (ngày giờ, số). */
export function intlLocale(lang: Lang): string {
  return lang === 'en' ? 'en-US' : 'vi-VN';
}
