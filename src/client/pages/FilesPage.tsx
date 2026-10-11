import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  CloudUpload,
  Download,
  Eye,
  FolderInput,
  FolderPlus,
  Globe,
  HardDrive,
  Link2,
  Lock,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { DriveListing, FileDTO, FolderDTO, Paginated } from '../../shared/types';
import { contentUrl, FileIcon, FilePreview, FolderIcon } from '../components/FilePreview';
import { Menu } from '../components/Menu';
import { Modal, useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, CenterSpinner, EmptyState, Input, Select } from '../components/ui';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, formatBytes, formatDateTime, timeAgo } from '../lib/format';
import { useDebounced, usePageTitle, useUsers } from '../lib/hooks';
import { publicFileUrl, uploads } from '../lib/upload';
import { t } from '../lib/i18n';

type MoveTarget = { kind: 'file'; item: FileDTO } | { kind: 'folder'; item: FolderDTO };

export default function FilesPage() {
  usePageTitle(t('Tệp tin'));
  const { user, isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const folderId = params.get('folder');
  const trashMode = params.get('trash') === '1';
  const ownerParam = params.get('owner') ?? '';
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm, prompt } = useConfirm();
  const users = useUsers(isAdmin);
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<FileDTO | null>(null);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [dragging, setDragging] = useState(false);

  const listing = useQuery({
    queryKey: ['drive', folderId, ownerParam],
    queryFn: () => apiGet<DriveListing>('/drive', { folder: folderId, owner: ownerParam }),
    enabled: !q && !trashMode,
  });
  const results = useQuery({
    queryKey: ['files', 'search', q, ownerParam],
    queryFn: () => apiGet<Paginated<FileDTO>>('/files', { q, owner: ownerParam, pageSize: 100 }),
    enabled: !!q,
  });

  const ownerId = listing.data?.owner.id ?? (ownerParam || user?.id || '');
  const isOwnDrive = ownerId === user?.id;

  const refresh = () => {
    for (const key of ['drive', 'files', 'me', 'stats']) void qc.invalidateQueries({ queryKey: [key] });
  };

  const go = (folder: string | null, owner = ownerParam) => {
    const next = new URLSearchParams();
    if (folder) next.set('folder', folder);
    if (owner) next.set('owner', owner);
    setSearch('');
    setParams(next);
  };

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    uploads.add(files, { folderId, ownerId: isOwnDrive ? undefined : ownerId });
  };

  const run = async (action: () => Promise<unknown>, success?: string) => {
    try {
      await action();
      if (success) toast.success(success);
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  const newFolder = async () => {
    const name = await prompt({ title: t('Thư mục mới'), input: { label: t('Tên thư mục'), placeholder: t('Ví dụ: Hợp đồng 2026') }, confirmText: t('Tạo') });
    if (name) await run(() => apiPost('/folders', { name, parentId: folderId, ownerId: isOwnDrive ? undefined : ownerId }));
  };

  const renameFolder = async (f: FolderDTO) => {
    const name = await prompt({ title: t('Đổi tên thư mục'), input: { defaultValue: f.name }, confirmText: t('Lưu') });
    if (name && name !== f.name) await run(() => apiPatch(`/folders/${f.id}`, { name }));
  };

  const deleteFolder = async (f: FolderDTO) => {
    if (await confirm({ title: t('Xóa thư mục?'), message: t('Thư mục “{name}” phải trống mới xóa được.', { name: f.name }), confirmText: t('Xóa'), danger: true })) {
      await run(() => apiDelete(`/folders/${f.id}`), t('Đã xóa thư mục'));
    }
  };

  const renameFile = async (f: FileDTO) => {
    const name = await prompt({ title: t('Đổi tên tệp'), input: { defaultValue: f.name }, confirmText: t('Lưu') });
    if (name && name !== f.name) await run(() => apiPatch(`/files/${f.id}`, { name }));
  };

  const copyLink = async (f: FileDTO) => {
    await navigator.clipboard.writeText(location.origin + publicFileUrl(f));
    toast.success(t('Đã sao chép liên kết công khai'));
  };

  const toggleShare = async (f: FileDTO) => {
    const visibility = f.visibility === 'public' ? 'private' : 'public';
    await run(async () => {
      await apiPatch(`/files/${f.id}`, { visibility });
      if (visibility === 'public') await copyLink(f);
    }, visibility === 'private' ? t('Đã tắt chia sẻ công khai') : undefined);
  };

  const deleteFile = async (f: FileDTO) => {
    if (await confirm({ title: t('Chuyển vào thùng rác?'), message: t('“{name}” ({size}) sẽ được chuyển vào thùng rác. Bạn có thể khôi phục trước khi thùng rác tự dọn.', { name: f.name, size: formatBytes(f.size) }), confirmText: t('Chuyển vào thùng rác'), danger: true })) {
      await run(() => apiDelete(`/files/${f.id}`), t('Đã chuyển vào thùng rác'));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles([...e.dataTransfer.files]);
  };

  if (trashMode) return <TrashView ownerParam={ownerParam} onBack={() => go(null)} />;

  const data = listing.data;
  const files = q ? results.data?.items : data?.files;
  const folders = q ? [] : (data?.folders ?? []);
  const loading = q ? results.isPending : listing.isPending;
  const error = q ? results.error : listing.error;

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
      className="relative"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('Tệp tin')}</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            icon={<Trash2 className="size-4" />}
            onClick={() => setParams(ownerParam ? { trash: '1', owner: ownerParam } : { trash: '1' })}
          >
            {t('Thùng rác')}
          </Button>
          <Button variant="outline" icon={<FolderPlus className="size-4" />} onClick={newFolder}>
            {t('Thư mục mới')}
          </Button>
          <Button icon={<Upload className="size-4" />} onClick={() => inputRef.current?.click()}>
            {t('Tải lên')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <Input className="pl-9" placeholder={t('Tìm tệp theo tên…')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isAdmin && (
          <Select className="w-auto min-w-56" value={ownerParam} onChange={(e) => go(null, e.target.value)} aria-label={t('Kho của người dùng')}>
            <option value="">{t('Kho của tôi')}</option>
            {users.data
              ?.filter((u) => u.id !== user?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {t('Kho của {name} ({size})', { name: u.name, size: formatBytes(u.storageUsed) })}
                </option>
              ))}
          </Select>
        )}
      </div>

      {!q && data && (
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm" aria-label={t('Đường dẫn thư mục')}>
          <button type="button" onClick={() => go(null)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <HardDrive className="size-4" />
            {isOwnDrive ? t('Tệp của tôi') : t('Tệp của {name}', { name: data.owner.name })}
          </button>
          {data.breadcrumb.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1">
              <ChevronRight className="size-4 text-zinc-400" />
              <button type="button" onClick={() => go(c.id)} className="rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                {c.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      <Card className="overflow-visible">
        {loading ? (
          <CenterSpinner />
        ) : error ? (
          <EmptyState title={t('Không tải được dữ liệu')} description={error.message} />
        ) : !folders.length && !files?.length ? (
          <EmptyState
            icon={<CloudUpload className="size-5" />}
            title={q ? t('Không tìm thấy tệp phù hợp') : t('Thư mục trống')}
            description={q ? undefined : t('Kéo-thả tệp vào đây hoặc bấm “Tải lên”. Hỗ trợ tệp tới 10GB, tự tải tiếp khi rớt mạng.')}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('Tên')}</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{t('Kích thước')}</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">{t('Cập nhật')}</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {folders.map((f) => (
                <tr key={f.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => go(f.id)}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-3">
                      <FolderIcon />
                      <span className="truncate font-medium">{f.name}</span>
                    </span>
                  </td>
                  <td className="hidden px-4 py-2.5 text-zinc-500 sm:table-cell">—</td>
                  <td className="hidden px-4 py-2.5 text-zinc-500 md:table-cell">{formatDateTime(f.updatedAt)}</td>
                  <td className="px-2">
                    <Menu
                      items={[
                        { label: t('Đổi tên'), icon: <Pencil />, onSelect: () => renameFolder(f) },
                        { label: t('Di chuyển tới…'), icon: <FolderInput />, onSelect: () => setMoving({ kind: 'folder', item: f }) },
                        { label: t('Xóa'), icon: <Trash2 />, onSelect: () => deleteFolder(f), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {files?.map((f) => (
                <tr key={f.id} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50" onClick={() => setPreview(f)}>
                  <td className="max-w-0 px-4 py-2.5">
                    <span className="flex items-center gap-3">
                      <FileIcon name={f.name} contentType={f.contentType} />
                      <span className="min-w-0">
                        <span className="block truncate">{f.name}</span>
                        <span className="flex items-center gap-2 text-xs text-zinc-500 sm:hidden">{formatBytes(f.size)}</span>
                        {q && isAdmin && <span className="block text-xs text-zinc-500">{t('của {name}', { name: f.ownerName })}</span>}
                      </span>
                      {f.visibility === 'public' && (
                        <Badge tone="green" className="shrink-0">
                          <Globe className="size-3" />{' '}{t('Công khai')}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap text-zinc-500 sm:table-cell">{formatBytes(f.size)}</td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap text-zinc-500 md:table-cell">{formatDateTime(f.updatedAt)}</td>
                  <td className="px-2">
                    <Menu
                      items={[
                        { label: t('Xem trước'), icon: <Eye />, onSelect: () => setPreview(f) },
                        { label: t('Tải xuống'), icon: <Download />, onSelect: () => window.location.assign(contentUrl(f, true)) },
                        { label: t('Đổi tên'), icon: <Pencil />, onSelect: () => renameFile(f) },
                        { label: t('Di chuyển tới…'), icon: <FolderInput />, onSelect: () => setMoving({ kind: 'file', item: f }) },
                        {
                          label: f.visibility === 'public' ? t('Tắt chia sẻ công khai') : t('Chia sẻ công khai'),
                          icon: f.visibility === 'public' ? <Lock /> : <Globe />,
                          onSelect: () => toggleShare(f),
                        },
                        { label: t('Sao chép liên kết'), icon: <Link2 />, onSelect: () => copyLink(f), hidden: f.visibility !== 'public' },
                        { label: t('Xóa'), icon: <Trash2 />, onSelect: () => deleteFile(f), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl border-2 border-dashed border-brand bg-brand/5 backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 text-brand">
            <CloudUpload className="size-10" />
            <p className="font-semibold">{t('Thả để tải lên')}{data?.folder ? ' ' + t('vào “{name}”', { name: data.folder.name }) : ''}</p>
          </div>
        </div>
      )}

      <FilePreview file={preview} onClose={() => setPreview(null)} />
      {moving && <MoveDialog target={moving} ownerId={ownerId} onClose={() => setMoving(null)} onMoved={refresh} />}
    </div>
  );
}

function MoveDialog({ target, ownerId, onClose, onMoved }: { target: MoveTarget; ownerId: string; onClose: () => void; onMoved: () => void }) {
  const toast = useToast();
  const [dest, setDest] = useState<string | null>(target.kind === 'file' ? target.item.folderId : target.item.parentId);
  const [busy, setBusy] = useState(false);
  const owner = target.item.ownerId || ownerId;
  const { data } = useQuery({
    queryKey: ['folders', owner],
    queryFn: async () => (await apiGet<{ folders: FolderDTO[] }>('/folders', { owner })).folders,
  });

  // Dựng cây thư mục; khi chuyển thư mục thì ẩn chính nó và các thư mục con.
  const tree = useMemo(() => {
    const children = new Map<string | null, FolderDTO[]>();
    for (const f of data ?? []) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f]);
    const out: { folder: FolderDTO; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of children.get(parent) ?? []) {
        if (target.kind === 'folder' && f.id === target.item.id) continue;
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [data, target]);

  const submit = async () => {
    setBusy(true);
    try {
      if (target.kind === 'file') await apiPatch(`/files/${target.item.id}`, { folderId: dest });
      else await apiPatch(`/folders/${target.item.id}`, { parentId: dest });
      toast.success(t('Đã di chuyển'));
      onMoved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const option = (id: string | null, label: string, depth = 0) => (
    <button
      key={id ?? 'root'}
      type="button"
      onClick={() => setDest(id)}
      style={{ paddingLeft: 12 + depth * 18 }}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg py-2 pr-3 text-left text-sm',
        dest === id ? 'bg-brand/10 font-medium text-brand' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
      )}
    >
      {id ? <FolderIcon className="size-4" /> : <HardDrive className="size-4" />}
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Di chuyển “{name}”', { name: target.item.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Hủy')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('Di chuyển tới đây')}
          </Button>
        </>
      }
    >
      {!data ? (
        <CenterSpinner />
      ) : (
        <div className="max-h-[50vh] space-y-0.5 overflow-auto">
          {option(null, t('Thư mục gốc'))}
          {tree.map(({ folder, depth }) => option(folder.id, folder.name, depth + 1))}
        </div>
      )}
    </Modal>
  );
}

/** Thùng rác: file đã xóa vẫn chiếm dung lượng tới khi bị dọn (tự động theo hạn hoặc khi gần hết hạn mức). */
function TrashView({ ownerParam, onBack }: { ownerParam: string; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { isAdmin } = useAuth();
  const { data, isPending } = useQuery({
    queryKey: ['trash', ownerParam],
    queryFn: async () => (await apiGet<{ items: FileDTO[] }>('/trash', { owner: ownerParam })).items,
  });
  const refresh = () => {
    for (const key of ['trash', 'drive', 'files', 'me', 'stats', 'usage']) void qc.invalidateQueries({ queryKey: [key] });
  };
  const total = data?.reduce((sum, f) => sum + f.size, 0) ?? 0;

  const restore = async (f: FileDTO) => {
    try {
      await apiPost(`/files/${f.id}/restore`);
      toast.success(t('Đã khôi phục “{name}”', { name: f.name }));
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };
  const purge = async (f: FileDTO) => {
    if (!(await confirm({ title: t('Xóa vĩnh viễn?'), message: t('“{name}” sẽ bị xóa hẳn và không thể khôi phục.', { name: f.name }), confirmText: t('Xóa vĩnh viễn'), danger: true }))) return;
    try {
      await apiDelete(`/files/${f.id}?permanent=1`);
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };
  const empty = async () => {
    if (!(await confirm({ title: t('Dọn sạch thùng rác?'), message: t('{n} tệp ({size}) sẽ bị xóa hẳn và không thể khôi phục.', { n: data?.length ?? 0, size: formatBytes(total) }), confirmText: t('Dọn sạch'), danger: true }))) return;
    try {
      const res = await apiDelete<{ files: number; bytes: number }>(`/trash${ownerParam ? `?owner=${ownerParam}` : ''}`);
      toast.success(t('Đã giải phóng {size}', { size: formatBytes(res.bytes) }));
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('Thùng rác')}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {t('Tệp trong thùng rác vẫn chiếm dung lượng. Hệ thống tự xóa hẳn khi hết thời gian lưu hoặc khi kho gần chạm hạn mức miễn phí.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}>
            {t('← Quay lại tệp')}
          </Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />} disabled={!data?.length} onClick={empty}>
            {t('Dọn sạch ({size})', { size: formatBytes(total) })}
          </Button>
        </div>
      </div>
      <Card>
        {isPending ? (
          <CenterSpinner />
        ) : !data?.length ? (
          <EmptyState icon={<Trash2 className="size-5" />} title={t('Thùng rác trống')} />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <FileIcon name={f.name} contentType={f.contentType} />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{f.name}</p>
                  <p className="text-xs text-zinc-500">
                    {formatBytes(f.size)} · {t('xóa {time}', { time: timeAgo(f.deletedAt) })}
                    {isAdmin && !ownerParam ? ` · ${t('của {name}', { name: f.ownerName })}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="outline" icon={<RotateCcw className="size-3.5" />} onClick={() => restore(f)}>
                  {t('Khôi phục')}
                </Button>
                <Button size="sm" variant="ghost" className="hover:text-red-600" onClick={() => purge(f)}>
                  {t('Xóa vĩnh viễn')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
