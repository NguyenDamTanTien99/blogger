import { createContext, Fragment, use, useCallback, useState, type ReactNode } from 'react';
import { intlLocale, normalizeLang, translate, type Lang, type Vars } from '../../shared/i18n';

const KEY = 'wb-lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return normalizeLang(saved);
  } catch {
    /* localStorage bị chặn */
  }
  return normalizeLang(navigator.language);
}

let current: Lang = detect();
document.documentElement.lang = current;

/** Ngôn ngữ hiện tại — dùng được cả ngoài React (api.ts, format.ts, upload.ts). */
export function getLang(): Lang {
  return current;
}

export function getLocale(): string {
  return intlLocale(current);
}

/** Dịch câu tiếng Việt sang ngôn ngữ đang chọn: t('Đã lưu'), t('Còn {n} file', { n }). */
export function t(text: string, vars?: Vars): string {
  return translate(current, text, vars);
}

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void }>({ lang: current, setLang: () => undefined });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(current);
  const setLang = useCallback((next: Lang) => {
    current = next;
    document.documentElement.lang = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* bỏ qua */
    }
    setState(next);
  }, []);
  // key={lang}: dựng lại giao diện để mọi chuỗi t() đổi ngôn ngữ (dữ liệu React Query và hàng đợi upload được giữ nguyên).
  return (
    <LangContext value={{ lang, setLang }}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext>
  );
}

export function useLang() {
  return use(LangContext);
}

export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`flex rounded-lg bg-zinc-100 p-0.5 text-xs font-semibold dark:bg-zinc-800 ${className ?? ''}`} role="group" aria-label="Language">
      {(['vi', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`flex-1 rounded-md px-2.5 py-1 ${lang === l ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100' : 'text-zinc-500'}`}
        >
          {l === 'vi' ? 'Tiếng Việt' : 'English'}
        </button>
      ))}
    </div>
  );
}
