import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CloudCheck, CloudOff, FilePlus2, LoaderCircle, NotebookPen, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { normalizeTags } from '../../shared/text';
import type { NoteDTO, NoteSummary, Paginated } from '../../shared/types';
import { MarkdownEditor } from '../components/Markdown';
import { useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, CenterSpinner, EmptyState, IconButton, Input, Pagination, Select } from '../components/ui';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, timeAgo } from '../lib/format';
import { useDebounced, usePageTitle, useUsers } from '../lib/hooks';
import { publicFileUrl, uploadFile } from '../lib/upload';

export default function NotesPage() {
  usePageTitle('Ghi chú');
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [owner, setOwner] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const users = useUsers(isAdmin);

  useEffect(() => setPage(1), [q, tag, owner]);

  const list = useQuery({
    queryKey: ['notes', { q, tag, owner, page }],
    queryFn: () => apiGet<Paginated<NoteSummary>>('/notes', { q, tag, owner, page, pageSize: 30 }),
    placeholderData: keepPreviousData,
  });
  const tags = useQuery({
    queryKey: ['notes', 'tags', owner],
    queryFn: async () => (await apiGet<{ tags: { name: string; count: number }[] }>('/notes/tags', { owner })).tags,
  });

  const create = async () => {
    try {
      const { note } = await apiPost<{ note: NoteDTO }>('/notes', { tags: tag ? [tag] : [] });
      void qc.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${note.id}`);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className={cn('min-w-0 space-y-3', id && 'hidden lg:block')}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Ghi chú</h1>
          <Button size="sm" icon={<FilePlus2 className="size-4" />} onClick={create}>
            Mới
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <Input className="pl-9" placeholder="Tìm trong tiêu đề, nội dung…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isAdmin && (
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Lọc theo người dùng">
            <option value="">Tất cả người dùng</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
        )}
        {!!tags.data?.length && (
          <div className="flex flex-wrap gap-1.5">
            {tags.data.slice(0, 24).map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => setTag((cur) => (cur === t.name ? '' : t.name))}
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs',
                  tag === t.name ? 'bg-brand text-white' : 'bg-zinc-200/70 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300',
                )}
              >
                #{t.name} <span className="opacity-60">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {list.isPending ? (
            <CenterSpinner />
          ) : !list.data?.items.length ? (
            <EmptyState
              icon={<NotebookPen className="size-5" />}
              title={q || tag ? 'Không có kết quả' : 'Chưa có ghi chú'}
              description={q || tag ? 'Thử từ khóa hoặc thẻ khác.' : 'Ghi lại ý tưởng, công việc, tài liệu… bằng Markdown.'}
            />
          ) : (
            <ul className="max-h-[calc(100vh-19rem)] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
              {list.data.items.map((n) => (
                <li key={n.id}>
                  <Link
                    to={`/notes/${n.id}`}
                    className={cn(
                      'block px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60',
                      n.id === id && 'bg-brand/5 ring-1 ring-brand/30 ring-inset',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {n.pinned && <Pin className="size-3.5 shrink-0 text-amber-500" />}
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{n.title || 'Ghi chú không tiêu đề'}</p>
                      <span className="shrink-0 text-[11px] text-zinc-400">{timeAgo(n.updatedAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{n.snippet.replace(/[#*_>`[\]]/g, '') || 'Trống'}</p>
                    {isAdmin && !owner && <p className="mt-1 text-[11px] text-zinc-400">của {n.ownerName}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </aside>

      <section className={cn('min-w-0', !id && 'hidden lg:block')}>
        {id ? (
          <NoteLoader key={id} id={id} />
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
            <EmptyState icon={<NotebookPen className="size-5" />} title="Chọn một ghi chú để xem & chỉnh sửa" description="Hoặc tạo ghi chú mới." />
          </div>
        )}
      </section>
    </div>
  );
}

function NoteLoader({ id }: { id: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['note', id],
    queryFn: async () => (await apiGet<{ note: NoteDTO }>(`/notes/${id}`)).note,
    staleTime: 0,
  });
  if (isPending) return <CenterSpinner />;
  if (error || !data) {
    return <EmptyState title="Không mở được ghi chú" description={error instanceof Error ? error.message : undefined} />;
  }
  return <NoteEditor note={data} />;
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

interface Draft {
  title: string;
  content: string;
  tags: string;
  pinned: boolean;
}

function NoteEditor({ note }: { note: NoteDTO }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const [draft, setDraft] = useState<Draft>({ title: note.title, content: note.content, tags: note.tags.join(', '), pinned: note.pinned });
  const [state, setState] = useState<SaveState>('saved');
  const [meta, setMeta] = useState({ updatedAt: note.updatedAt, updatedByName: note.updatedByName });

  // Ref để hàm lưu luôn đọc dữ liệu mới nhất mà không phải tạo lại.
  const latest = useRef(draft);
  latest.current = draft;
  const base = useRef(note.updatedAt);
  const dirty = useRef(false);
  const inflight = useRef(false);
  const conflict = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useCallback(
    async (force = false) => {
      if (inflight.current || (conflict.current && !force) || (!dirty.current && !force)) return;
      inflight.current = true;
      dirty.current = false;
      setState('saving');
      const d = latest.current;
      try {
        const { note: saved } = await apiPatch<{ note: NoteDTO }>(`/notes/${note.id}`, {
          title: d.title,
          content: d.content,
          tags: normalizeTags(d.tags),
          pinned: d.pinned,
          baseUpdatedAt: force ? undefined : base.current,
        });
        base.current = saved.updatedAt;
        conflict.current = false;
        setMeta({ updatedAt: saved.updatedAt, updatedByName: saved.updatedByName });
        qc.setQueryData(['note', note.id], saved);
        void qc.invalidateQueries({ queryKey: ['notes'] });
        setState(dirty.current ? 'dirty' : 'saved');
      } catch (err) {
        dirty.current = true;
        if (err instanceof ApiError && err.status === 409) {
          conflict.current = true;
          setState('conflict');
        } else {
          setState('error');
          toast.error(err);
        }
      } finally {
        inflight.current = false;
      }
      if (dirty.current && !conflict.current) timer.current = setTimeout(() => void save(), 900);
    },
    [note.id, qc, toast],
  );

  const change = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    dirty.current = true;
    if (!conflict.current) setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 900);
  };

  // Rời trang khi còn thay đổi chưa lưu => lưu ngay; đóng tab => cảnh báo.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || inflight.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimeout(timer.current);
      if (dirty.current && !conflict.current) void save();
    };
  }, [save]);

  const reloadLatest = async () => {
    try {
      const { note: fresh } = await apiGet<{ note: NoteDTO }>(`/notes/${note.id}`);
      clearTimeout(timer.current);
      conflict.current = false;
      dirty.current = false;
      base.current = fresh.updatedAt;
      setDraft({ title: fresh.title, content: fresh.content, tags: fresh.tags.join(', '), pinned: fresh.pinned });
      setMeta({ updatedAt: fresh.updatedAt, updatedByName: fresh.updatedByName });
      qc.setQueryData(['note', note.id], fresh);
      setState('saved');
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Xóa ghi chú?', message: `“${draft.title || 'Ghi chú không tiêu đề'}” sẽ bị xóa vĩnh viễn.`, confirmText: 'Xóa', danger: true }))) return;
    try {
      clearTimeout(timer.current);
      dirty.current = false;
      await apiDelete(`/notes/${note.id}`);
      void qc.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Đã xóa ghi chú');
      navigate('/notes', { replace: true });
    } catch (err) {
      toast.error(err);
    }
  };

  const uploadAttachment = async (file: File) => {
    const f = await uploadFile(file, { folderId: null, ownerId: note.ownerId, visibility: file.type.startsWith('image/') ? 'public' : 'private' });
    void qc.invalidateQueries({ queryKey: ['me'] });
    return file.type.startsWith('image/') ? `![${f.name}](${publicFileUrl(f)})` : `[📎 ${f.name}](/api/files/${f.id}/content?download=1)`;
  };

  const indicator = {
    saved: { icon: <CloudCheck className="size-4" />, text: 'Đã lưu', cls: 'text-zinc-400' },
    dirty: { icon: <LoaderCircle className="size-4" />, text: 'Chưa lưu…', cls: 'text-zinc-400' },
    saving: { icon: <LoaderCircle className="size-4 animate-spin" />, text: 'Đang lưu…', cls: 'text-zinc-400' },
    error: { icon: <CloudOff className="size-4" />, text: 'Lỗi lưu', cls: 'text-red-500' },
    conflict: { icon: <CloudOff className="size-4" />, text: 'Xung đột', cls: 'text-amber-600' },
  }[state];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link to="/notes" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 lg:hidden dark:hover:text-zinc-100">
          <ArrowLeft className="size-4" /> Ghi chú
        </Link>
        <span className={cn('ml-auto inline-flex items-center gap-1.5 text-xs', indicator.cls)}>
          {indicator.icon}
          {indicator.text}
        </span>
        <IconButton label={draft.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'} onClick={() => change({ pinned: !draft.pinned })}>
          {draft.pinned ? <PinOff className="size-4 text-amber-500" /> : <Pin className="size-4" />}
        </IconButton>
        <IconButton label="Xóa ghi chú" onClick={remove} className="hover:text-red-600">
          <Trash2 className="size-4" />
        </IconButton>
      </div>

      {state === 'conflict' && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <span className="flex-1">Ghi chú vừa được sửa ở nơi khác. Bạn muốn làm gì?</span>
          <Button size="sm" variant="outline" onClick={reloadLatest}>
            Tải bản mới nhất
          </Button>
          <Button size="sm" onClick={() => void save(true)}>
            Ghi đè bằng bản của tôi
          </Button>
        </div>
      )}

      <input
        value={draft.title}
        onChange={(e) => change({ title: e.target.value })}
        placeholder="Tiêu đề"
        maxLength={300}
        className="w-full bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <Input
          value={draft.tags}
          onChange={(e) => change({ tags: e.target.value })}
          placeholder="Thẻ, cách nhau bởi dấu phẩy"
          className="h-8 max-w-xs text-xs"
        />
        {note.ownerId !== user?.id && <Badge tone="amber">Của {note.ownerName}</Badge>}
        <span>
          Sửa {timeAgo(meta.updatedAt)}
          {meta.updatedByName ? ` bởi ${meta.updatedByName}` : ''}
        </span>
      </div>
      <MarkdownEditor
        value={draft.content}
        onChange={(content) => change({ content })}
        onUpload={uploadAttachment}
        placeholder={'Viết bằng Markdown…\n\n# Tiêu đề\n- [ ] Việc cần làm\n**đậm**, _nghiêng_, `code`\n\nDán hoặc kéo-thả ảnh/file vào đây để đính kèm.'}
        minHeight={460}
      />
    </div>
  );
}
