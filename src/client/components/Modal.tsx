import { X } from 'lucide-react';
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/format';
import { Button, IconButton, Input } from './ui';
import { t } from '../lib/i18n';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-[min(1200px,96vw)]' };

/** Dùng <dialog> gốc của trình duyệt: có sẵn bẫy focus, phím Esc và lớp nền. */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl',
        'dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
        SIZES[size],
      )}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
            <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
            <IconButton label={t('Đóng')} onClick={onClose} className="-mr-2">
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------- Hộp thoại xác nhận / nhập liệu dạng Promise ----------

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** Nếu có: hiện ô nhập liệu, kết quả trả về là chuỗi đã nhập. */
  input?: { label?: string; defaultValue?: string; placeholder?: string };
}

type Resolver = (value: string | boolean | null) => void;

const ConfirmContext = createContext<((o: ConfirmOptions) => Promise<string | boolean | null>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: Resolver } | null>(null);
  const [text, setText] = useState('');

  const ask = useCallback(
    (options: ConfirmOptions) =>
      new Promise<string | boolean | null>((resolve) => {
        setText(options.input?.defaultValue ?? '');
        setState({ options, resolve });
      }),
    [],
  );

  const close = (value: string | boolean | null) => {
    state?.resolve(value);
    setState(null);
  };
  const o = state?.options;
  const submit = () => close(o?.input ? text.trim() || null : true);

  return (
    <ConfirmContext value={ask}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(o?.input ? null : false)}
        title={o?.title ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(o?.input ? null : false)}>
              {t('Hủy')}
            </Button>
            <Button variant={o?.danger ? 'danger' : 'primary'} onClick={submit}>
              {o?.confirmText ?? t('Đồng ý')}
            </Button>
          </>
        }
      >
        {o?.message && <div className="text-sm text-zinc-600 dark:text-zinc-400">{o.message}</div>}
        {o?.input && (
          <form
            className="mt-2 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            {o.input.label && <span className="block text-sm font-medium">{o.input.label}</span>}
            <Input autoFocus value={text} placeholder={o.input.placeholder} onChange={(e) => setText(e.target.value)} />
          </form>
        )}
      </Modal>
    </ConfirmContext>
  );
}

export function useConfirm() {
  const ask = use(ConfirmContext);
  if (!ask) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return {
    confirm: async (o: Omit<ConfirmOptions, 'input'>) => (await ask(o)) === true,
    prompt: async (o: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> }) => {
      const value = await ask(o);
      return typeof value === 'string' ? value : null;
    },
  };
}
