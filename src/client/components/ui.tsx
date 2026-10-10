import { LoaderCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/format';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white shadow-sm hover:brightness-110 active:brightness-95',
  secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
  outline:
    'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
  ghost: 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
};

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-grid size-9 shrink-0 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900',
        'focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

const FIELD =
  'w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 ' +
  'focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(FIELD, 'h-10', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(FIELD, 'py-2 leading-relaxed', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(FIELD, 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      {children}
      {error ? <span className="block text-xs text-red-600">{error}</span> : hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div className={cn('rounded-xl border border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900', className)} {...rest}>
      {children}
    </div>
  );
}

const BADGE = {
  gray: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  brand: 'bg-brand/10 text-brand',
};

export function Badge({ tone = 'gray', children, className }: { tone?: keyof typeof BADGE; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', BADGE[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-5 animate-spin text-zinc-400', className)} />;
}

export function CenterSpinner() {
  return (
    <div className="grid min-h-40 place-items-center">
      <Spinner className="size-6" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 grid size-12 place-items-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-3 text-sm disabled:opacity-50"
    >
      <span className={cn('relative h-6 w-10 rounded-full transition', checked ? 'bg-brand' : 'bg-zinc-300 dark:bg-zinc-700')}>
        <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function ProgressBar({ value, tone = 'brand', className }: { value: number; tone?: 'brand' | 'amber' | 'red'; className?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  const color = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-brand';
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-zinc-500">
      <span>
        Trang {page}/{pages} · {total} mục
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Trước
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Sau
        </Button>
      </div>
    </div>
  );
}
