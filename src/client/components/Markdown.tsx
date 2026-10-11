import {
  Bold,
  Code,
  Columns2,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Pencil,
  Quote,
  Table,
} from 'lucide-react';
import { useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/format';
import { useMarkdown } from '../lib/useMarkdown';
import { Spinner } from './ui';
import { t } from '../lib/i18n';

/** Hiển thị markdown đã lọc XSS (an toàn kể cả với nội dung của người dùng khác). */
export function MarkdownView({ source, className }: { source: string; className?: string }) {
  const md = useMarkdown();
  const html = useMemo(() => (md ? md.renderSafe(source) : null), [md, source]);
  if (html === null) return <Spinner />;
  return <div className={cn('prose-content', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

type Mode = 'write' | 'preview' | 'split';

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Upload ảnh/file, trả về đoạn markdown để chèn (vd: ![ảnh](/f/...)). */
  onUpload?: (file: File) => Promise<string>;
  className?: string;
  minHeight?: number;
}

export function MarkdownEditor({ value, onChange, placeholder, onUpload, className, minHeight = 420 }: EditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('write');
  const [busy, setBusy] = useState(false);

  /** Thay đoạn văn bản bằng execCommand để giữ được Ctrl+Z; dự phòng setRangeText. */
  const replace = (start: number, end: number, text: string, selStart?: number, selEnd?: number) => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, start, end, 'end');
      onChange(ta.value);
    }
    if (selStart !== undefined) ta.setSelectionRange(selStart, selEnd ?? selStart);
  };

  const wrap = (before: string, after = before, fallback = t('văn bản')) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const selected = ta.value.slice(s, e) || fallback;
    replace(s, e, before + selected + after, s + before.length, s + before.length + selected.length);
  };

  const prefixLines = (prefix: (index: number) => string) => {
    const ta = ref.current;
    if (!ta) return;
    const v = ta.value;
    const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const nl = v.indexOf('\n', ta.selectionEnd);
    const end = nl === -1 ? v.length : nl;
    const text = v
      .slice(start, end)
      .split('\n')
      .map((line, i) => prefix(i) + line)
      .join('\n');
    replace(start, end, text, start, start + text.length);
  };

  const insert = (text: string) => {
    const ta = ref.current;
    if (!ta) return;
    const pos = ta.selectionEnd;
    replace(pos, pos, text, pos + text.length);
  };

  const upload = async (files: File[]) => {
    if (!onUpload || !files.length) return;
    setBusy(true);
    try {
      for (const f of files) insert(`${await onUpload(f)}\n`);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('**');
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrap('_');
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      wrap('[', '](https://)', t('liên kết'));
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      insert('  ');
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length && onUpload) {
      e.preventDefault();
      void upload(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = [...e.dataTransfer.files];
    if (files.length && onUpload) {
      e.preventDefault();
      void upload(files);
    }
  };

  const tools: { label: string; icon: ReactNode; run: () => void }[] = [
    { label: t('Đậm (Ctrl+B)'), icon: <Bold />, run: () => wrap('**') },
    { label: t('Nghiêng (Ctrl+I)'), icon: <Italic />, run: () => wrap('_') },
    { label: t('Tiêu đề'), icon: <Heading2 />, run: () => prefixLines(() => '## ') },
    { label: t('Trích dẫn'), icon: <Quote />, run: () => prefixLines(() => '> ') },
    { label: t('Danh sách'), icon: <List />, run: () => prefixLines(() => '- ') },
    { label: t('Danh sách số'), icon: <ListOrdered />, run: () => prefixLines((i) => `${i + 1}. `) },
    { label: t('Việc cần làm'), icon: <ListChecks />, run: () => prefixLines(() => '- [ ] ') },
    { label: 'Code', icon: <Code />, run: () => wrap('\n```\n', '\n```\n', 'code') },
    { label: t('Liên kết (Ctrl+K)'), icon: <Link2 />, run: () => wrap('[', '](https://)', t('liên kết')) },
    { label: t('Bảng'), icon: <Table />, run: () => insert(t('\n| Cột 1 | Cột 2 |\n| --- | --- |\n| A | B |\n')) },
  ];

  const modes: { id: Mode; label: string; icon: ReactNode; className?: string }[] = [
    { id: 'write', label: t('Soạn'), icon: <Pencil /> },
    { id: 'preview', label: t('Xem trước'), icon: <Eye /> },
    { id: 'split', label: 'Song song', icon: <Columns2 />, className: 'hidden lg:inline-flex' },
  ];

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900', className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
        {mode !== 'preview' &&
          tools.map((tk) => (
            <button
              key={tk.label}
              type="button"
              title={tk.label}
              aria-label={tk.label}
              onClick={tk.run}
              className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 [&>svg]:size-4"
            >
              {tk.icon}
            </button>
          ))}
        {onUpload && mode !== 'preview' && (
          <>
            <button
              type="button"
              title={t('Chèn ảnh / file')}
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="grid size-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 [&>svg]:size-4"
            >
              {busy ? <Spinner className="size-4" /> : <ImagePlus />}
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void upload([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </>
        )}
        <div className="ml-auto flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium [&>svg]:size-3.5',
                mode === m.id ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100',
                m.className,
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className={cn('grid min-h-0 flex-1', mode === 'split' && 'lg:grid-cols-2')}>
        {mode !== 'preview' && (
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDrop={onDrop}
            placeholder={placeholder}
            spellCheck={false}
            style={{ minHeight }}
            className="w-full resize-y bg-transparent p-4 font-mono text-[13.5px] leading-relaxed outline-none placeholder:text-zinc-400"
          />
        )}
        {mode !== 'write' && (
          <div
            style={{ minHeight }}
            className={cn('overflow-auto p-4', mode === 'split' && 'border-l border-zinc-200 dark:border-zinc-800')}
          >
            {value.trim() ? <MarkdownView source={value} /> : <p className="text-sm text-zinc-400">{t('Chưa có nội dung.')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
