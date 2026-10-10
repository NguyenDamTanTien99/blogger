import {
  Download,
  File as FileIconBase,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Image as ImageIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PREVIEW_MAX_BYTES } from '../../shared/constants';
import { extensionOf, fileKind, type FileKind } from '../../shared/mime';
import type { FileDTO } from '../../shared/types';
import { cn, formatBytes } from '../lib/format';
import { Modal } from './Modal';
import { Button, CenterSpinner } from './ui';

const ICONS: Record<FileKind, { icon: typeof FileIconBase; color: string }> = {
  image: { icon: ImageIcon, color: 'text-pink-500' },
  video: { icon: FileVideo, color: 'text-violet-500' },
  audio: { icon: FileAudio, color: 'text-orange-500' },
  pdf: { icon: FileText, color: 'text-red-500' },
  word: { icon: FileText, color: 'text-blue-600' },
  excel: { icon: FileSpreadsheet, color: 'text-emerald-600' },
  text: { icon: FileCode, color: 'text-zinc-500' },
  archive: { icon: FileArchive, color: 'text-amber-600' },
  other: { icon: FileIconBase, color: 'text-zinc-400' },
};

export function FileIcon({ name, contentType, className }: { name: string; contentType: string; className?: string }) {
  const { icon: Icon, color } = ICONS[fileKind(name, contentType)];
  return <Icon className={cn('size-5 shrink-0', color, className)} />;
}

export function FolderIcon({ className }: { className?: string }) {
  return <Folder className={cn('size-5 shrink-0 fill-amber-300/60 text-amber-500', className)} />;
}

export const contentUrl = (file: Pick<FileDTO, 'id'>, download = false) =>
  `/api/files/${file.id}/content${download ? '?download=1' : ''}`;

export function FilePreview({ file, onClose }: { file: FileDTO | null; onClose: () => void }) {
  return (
    <Modal
      open={!!file}
      onClose={onClose}
      size="full"
      title={file ? `${file.name} · ${formatBytes(file.size)}` : ''}
      footer={
        file && (
          <a href={contentUrl(file, true)} download>
            <Button icon={<Download className="size-4" />}>Tải xuống</Button>
          </a>
        )
      }
    >
      {file && <PreviewBody file={file} />}
    </Modal>
  );
}

function PreviewBody({ file }: { file: FileDTO }) {
  const url = contentUrl(file);
  const ext = extensionOf(file.name);
  switch (fileKind(file.name, file.contentType)) {
    case 'image':
      return <img src={url} alt={file.name} className="mx-auto max-h-[72vh] rounded-lg object-contain" />;
    case 'video':
      return <video src={url} controls preload="metadata" className="mx-auto max-h-[72vh] w-full rounded-lg bg-black" />;
    case 'audio':
      return <audio src={url} controls className="w-full" />;
    case 'pdf':
      return <iframe src={url} title={file.name} className="h-[74vh] w-full rounded-lg border border-zinc-200 dark:border-zinc-800" />;
    case 'text':
      return <TextPreview url={url} size={file.size} />;
    case 'word':
      return ext === 'docx' ? <DocxPreview url={url} size={file.size} /> : <NoPreview reason="Chỉ xem trước được định dạng .docx." />;
    case 'excel':
      if (ext === 'xlsx') return <XlsxPreview url={url} size={file.size} />;
      if (ext === 'csv') return <TextPreview url={url} size={file.size} />;
      return <NoPreview reason="Chỉ xem trước được định dạng .xlsx và .csv." />;
    default:
      return <NoPreview />;
  }
}

function NoPreview({ reason }: { reason?: string }) {
  return (
    <div className="py-16 text-center text-sm text-zinc-500">
      <p>Không thể xem trước loại file này trong trình duyệt.</p>
      {reason && <p className="mt-1">{reason}</p>}
      <p className="mt-1">Hãy bấm “Tải xuống” để mở bằng ứng dụng trên máy.</p>
    </div>
  );
}

function useBlob(url: string, size: number, maxBytes = PREVIEW_MAX_BYTES) {
  const [state, setState] = useState<{ blob?: Blob; error?: string }>({});
  useEffect(() => {
    if (size > maxBytes) {
      setState({ error: `File lớn hơn ${formatBytes(maxBytes)} — hãy tải xuống để xem.` });
      return;
    }
    const ctrl = new AbortController();
    setState({});
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`Lỗi ${r.status}`))))
      .then((blob) => setState({ blob }))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setState({ error: err instanceof Error ? err.message : 'Không tải được file.' });
      });
    return () => ctrl.abort();
  }, [url, size, maxBytes]);
  return state;
}

const TEXT_LIMIT = 2 * 1024 * 1024;

function TextPreview({ url, size }: { url: string; size: number }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    // File lớn: chỉ đọc 2MB đầu bằng Range request.
    fetch(url, { signal: ctrl.signal, headers: size > TEXT_LIMIT ? { Range: `bytes=0-${TEXT_LIMIT - 1}` } : undefined })
      .then((r) => r.text())
      .then(setText)
      .catch(() => !ctrl.signal.aborted && setText('Không đọc được nội dung.'));
    return () => ctrl.abort();
  }, [url, size]);
  if (text === null) return <CenterSpinner />;
  return (
    <>
      {size > TEXT_LIMIT && <p className="mb-2 text-xs text-amber-600">Chỉ hiển thị 2MB đầu tiên của file.</p>}
      <pre className="max-h-[70vh] overflow-auto rounded-lg bg-zinc-50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap dark:bg-zinc-950">
        {text}
      </pre>
    </>
  );
}

function DocxPreview({ url, size }: { url: string; size: number }) {
  const host = useRef<HTMLDivElement>(null);
  const { blob, error } = useBlob(url, size);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  useEffect(() => {
    if (!blob || !host.current) return;
    let cancelled = false;
    const el = host.current;
    import('docx-preview')
      .then(({ renderAsync }) =>
        renderAsync(blob, el, undefined, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, useBase64URL: true }),
      )
      .then(() => {
        // Chỉ giữ link http(s) trong tài liệu (phòng link javascript: trong file độc hại).
        el.querySelectorAll('a[href]').forEach((a) => {
          if (!/^(https?:|#)/i.test(a.getAttribute('href') ?? '')) a.removeAttribute('href');
          else a.setAttribute('target', '_blank');
        });
        if (!cancelled) setStatus('done');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [blob]);
  if (error) return <NoPreview reason={error} />;
  return (
    <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-950 sm:p-4">
      {status === 'loading' && <CenterSpinner />}
      {status === 'error' && <NoPreview reason="File Word bị lỗi hoặc dùng định dạng chưa hỗ trợ." />}
      <div ref={host} className="docx-host overflow-auto text-black" />
    </div>
  );
}

type Cell = string | number | boolean | Date | null | object;
interface SheetData {
  sheet: string;
  data: Cell[][];
}

function cellText(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toLocaleDateString('vi-VN');
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

const MAX_ROWS = 1000;
const MAX_COLS = 60;

function XlsxPreview({ url, size }: { url: string; size: number }) {
  const { blob, error } = useBlob(url, size);
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [active, setActive] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    import('read-excel-file/browser')
      .then(({ default: readXlsxFile }) => readXlsxFile(blob))
      .then((result) => !cancelled && setSheets(result as unknown as SheetData[]))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [blob]);
  if (error) return <NoPreview reason={error} />;
  if (failed) return <NoPreview reason="File Excel bị lỗi hoặc dùng định dạng chưa hỗ trợ." />;
  if (!sheets) return <CenterSpinner />;
  const sheet = sheets[active];
  const rows = sheet?.data.slice(0, MAX_ROWS) ?? [];
  return (
    <div className="space-y-3">
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {sheets.map((s, i) => (
            <button
              key={s.sheet}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                i === active ? 'bg-brand text-white' : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700',
              )}
            >
              {s.sheet}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[66vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full border-collapse text-xs">
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={r === 0 ? 'bg-zinc-100 font-semibold dark:bg-zinc-800' : undefined}>
                <td className="sticky left-0 w-px border border-zinc-200 bg-zinc-50 px-2 py-1 text-right whitespace-nowrap text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
                  {r + 1}
                </td>
                {row.slice(0, MAX_COLS).map((cell, c) => (
                  <td key={c} className="max-w-xs truncate border border-zinc-200 px-2 py-1 dark:border-zinc-800">
                    {cellText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(sheet?.data.length ?? 0) > MAX_ROWS && <p className="text-xs text-zinc-500">Chỉ hiển thị {MAX_ROWS} dòng đầu tiên.</p>}
    </div>
  );
}
