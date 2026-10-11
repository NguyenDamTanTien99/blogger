import { EllipsisVertical } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/format';
import { t } from '../lib/i18n';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

/** Menu thao tác "⋮" gọn nhẹ: đóng khi bấm ra ngoài hoặc nhấn Esc. */
export function Menu({ items, label = t('Thao tác') }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visible = items.filter((i) => !i.hidden);
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const rect = ref.current?.getBoundingClientRect();
          setUp(!!rect && window.innerHeight - rect.bottom < visible.length * 40 + 24);
          setOpen((v) => !v);
        }}
        className="inline-grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <EllipsisVertical className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 z-30 min-w-48 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900',
            up ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800',
                item.danger ? 'text-red-600 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-200',
              )}
            >
              <span className="text-zinc-400 [&>svg]:size-4">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
