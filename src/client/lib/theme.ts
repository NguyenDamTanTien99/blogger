import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';
const KEY = 'wb-theme';

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function apply(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

/** Theme sáng/tối/tự động — đồng bộ với blog công khai qua cùng khóa localStorage. */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  useEffect(() => {
    apply(mode);
    try {
      if (mode === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch {
      /* chế độ riêng tư */
    }
    if (mode !== 'auto') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('auto');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);
  return { mode, setMode };
}

export function setBrandColor(color: string) {
  if (/^#[0-9a-f]{6}$/i.test(color)) document.documentElement.style.setProperty('--brand', color);
}
