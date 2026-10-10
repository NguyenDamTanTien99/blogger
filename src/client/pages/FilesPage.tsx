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
import { cn, formatBytes, formatDateTime } from '../lib/format';
import { useDebounced, usePageTitle, useUsers } from '../lib/hooks';
import { publicFileUrl, uploads } from '../lib/upload';

type MoveTarget = { kind: 'file'; item: FileDTO } | { kind: 'folder'; item: FolderDTO };

export default function FilesPage() {
  usePageTitle('Tệp tin');
  const { user, isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const folderId = params.get('folder');
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
    enabled: !q,
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
    const name = await prompt({ title: 'Thư mục mới', input: { label: 'Tên thư mục', placeholder: 'Ví dụ: Hợp đồng 2026' }, confirmText: 'Tạo' });
    if (name) await run(() => apiPost('/folders', { name, parentId: folderId, ownerId: isOwnDrive ? undefined : ownerId }));
  };

  const renameFolder = async (f: FolderDTO) => {
    const name = await prompt({ title: 'Đổi tên thư mục', input: { defaultValue: f.name }, confirmText: 'Lưu' });
    if (name && name !== f.name) await run(() => apiPatch(`/folders/${f.id}`, { name }));
  };

  const deleteFolder = async (f: FolderDTO) => {
    if (await confirm({ title: 'Xóa thư mục?', message: `Thư mục “${f.name}” phải trống mới xóa được.`, confirmText: 'Xóa', danger: true })) {
      await run(() => apiDelete(`/folders/${f.id}`), 'Đã xóa thư mục');
    }
  };

  const renameFile = async (f: FileDTO) => {
    const name = await prompt({ title: 'Đổi tên tệp', input: { defaultValue: f.name }, confirmText: 'Lưu' });
    if (name && name !== f.name) await run(() => apiPatch(`/files/${f.id}`, { name }));
  };

  const copyLink = async (f: FileDTO) => {
    await navigator.clipboard.writeText(location.origin + publicFileUrl(f));
    toast.success('Đã sao chép liên kết công khai');
  };

  const toggleShare = async (f: FileDTO) => {
    const visibility = f.visibility === 'public' ? 'private' : 'public';
    await run(async () => {
      await apiPatch(`/files/${f.id}`, { visibility });
      if (visibility === 'public') await copyLink(f);
    }, visibility === 'private' ? 'Đã tắt chia sẻ công khai' : undefined);
  };

  const deleteFile = async (f: FileDTO) => {
    if (await confirm({ title: 'Xóa tệp?', message: `“${f.name}” (${formatBytes(f.size)}) sẽ bị xóa vĩnh viễn.`, confirmText: 'Xóa', danger: true })) {
      await run(() => apiDelete(`/files/${f.id}`), 'Đã xóa tệp');
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles([...e.dataTransfer.files]);
  };

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
        <h1 className="text-2xl font-bold tracking-tight">Tệp tin</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<FolderPlus className="size-4" />} onClick={newFolder}>
            Thư mục mới
          </Button>
          <Button icon={<Upload className="size-4" />} onClick={() => inputRef.current?.click()}>
            Tải lên
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
          <Input className="pl-9" placeholder="Tìm tệp theo tên…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isAdmin && (
          <Select className="w-auto min-w-56" value={ownerParam} onChange={(e) => go(null, e.target.value)} aria-label="Kho của người dùng">
            <option value="">Kho của tôi</option>
            {users.data
              ?.filter((u) => u.id !== user?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  Kho của {u.name} ({formatBytes(u.storageUsed)})
                </option>
              ))}
          </Select>
        )}
      </div>

      {!q && data && (
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm" aria-label="Đường dẫn thư mục">
          <button type="button" onClick={() => go(null)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <HardDrive className="size-4" />
            {isOwnDrive ? 'Tệp của tôi' : `Tệp của ${data.owner.name}`}
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
          <EmptyState title="Không tải được dữ liệu" description={error.message} />
        ) : !folders.length && !files?.length ? (
          <EmptyState
            icon={<CloudUpload className="size-5" />}
            title={q ? 'Không tìm thấy tệp phù hợp' : 'Thư mục trống'}
            description={q ? undefined : 'Kéo-thả tệp vào đây hoặc bấm “Tải lên”. Hỗ trợ tệp tới 10GB, tự tải tiếp khi rớt mạng.'}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">Tên</th>
                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Kích thước</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Cập nhật</th>
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
                        { label: 'Đổi tên', icon: <Pencil />, onSelect: () => renameFolder(f) },
                        { label: 'Di chuyển tới…', icon: <FolderInput />, onSelect: () => setMoving({ kind: 'folder', item: f }) },
                        { label: 'Xóa', icon: <Trash2 />, onSelect: () => deleteFolder(f), danger: true },
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
                        {q && isAdmin && <span className="block text-xs text-zinc-500">của {f.ownerName}</span>}
                      </span>
                      {f.visibility === 'public' && (
                        <Badge tone="green" className="shrink-0">
                          <Globe className="size-3" /> Công khai
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap text-zinc-500 sm:table-cell">{formatBytes(f.size)}</td>
                  <td className="hidden px-4 py-2.5 whitespace-nowrap text-zinc-500 md:table-cell">{formatDateTime(f.updatedAt)}</td>
                  <td className="px-2">
                    <Menu
                      items={[
                        { label: 'Xem trước', icon: <Eye />, onSelect: () => setPreview(f) },
                        { label: 'Tải xuống', icon: <Download />, onSelect: () => window.location.assign(contentUrl(f, true)) },
                        { label: 'Đổi tên', icon: <Pencil />, onSelect: () => renameFile(f) },
                        { label: 'Di chuyển tới…', icon: <FolderInput />, onSelect: () => setMoving({ kind: 'file', item: f }) },
                        {
                          label: f.visibility === 'public' ? 'Tắt chia sẻ công khai' : 'Chia sẻ công khai',
                          icon: f.visibility === 'public' ? <Lock /> : <Globe />,
                          onSelect: () => toggleShare(f),
                        },
                        { label: 'Sao chép liên kết', icon: <Link2 />, onSelect: () => copyLink(f), hidden: f.visibility !== 'public' },
                        { label: 'Xóa', icon: <Trash2 />, onSelect: () => deleteFile(f), danger: true },
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
            <p className="font-semibold">Thả để tải lên{data?.folder ? ` vào “${data.folder.name}”` : ''}</p>
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
      toast.success('Đã di chuyển');
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
      title={`Di chuyển “${target.item.name}”`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={submit} loading={busy}>
            Di chuyển tới đây
          </Button>
        </>
      }
    >
      {!data ? (
        <CenterSpinner />
      ) : (
        <div className="max-h-[50vh] space-y-0.5 overflow-auto">
          {option(null, 'Thư mục gốc')}
          {tree.map(({ folder, depth }) => option(folder.id, folder.name, depth + 1))}
        </div>
      )}
    </Modal>
  );
}
