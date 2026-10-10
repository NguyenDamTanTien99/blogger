import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { errorMessage } from '../lib/api';
import { cn } from '../lib/format';

interface ToastItem {
  id: number;
  tone: 'success' | 'error';
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (err: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: ToastItem['tone'], message: string) => {
      const id = nextId++;
      setItems((list) => [...list.slice(-3), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push('success', m), error: (err) => push('error', errorMessage(err)) }),
    [push],
  );

  return (
    <ToastContext value={api}>
      {children}
      {/* Giữa-trên: không đè bảng upload (góc dưới phải) và thanh "chưa lưu" (giữa-dưới). */}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg',
              'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900',
            )}
          >
            {t.tone === 'success' ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />
            )}
            <p className="flex-1">{t.message}</p>
            <button type="button" aria-label="Đóng" onClick={() => dismiss(t.id)} className="text-zinc-400 hover:text-zinc-700">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
