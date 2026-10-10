import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, ImagePlus, Save, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { normalizeTags, slugify } from '../../shared/text';
import type { FolderDTO, PostDTO, PostStatus, PostType } from '../../shared/types';
import { MarkdownEditor } from '../components/Markdown';
import { useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Button, Card, CenterSpinner, EmptyState, Field, Input, Select, Textarea } from '../components/ui';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { fromLocalInput, toLocalInput } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { publicFileUrl, uploadFile } from '../lib/upload';
import { loadMarkdown } from '../lib/useMarkdown';
import { publicPostUrl } from './PostsPage';

export default function PostEditorPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { data, isPending, error } = useQuery({
    queryKey: ['post', id],
    queryFn: async () => (await apiGet<{ post: PostDTO }>(`/posts/${id}`)).post,
    enabled: !isNew,
    staleTime: 0,
  });
  if (!isNew && isPending) return <CenterSpinner />;
  if (!isNew && (error || !data)) return <EmptyState title="Không mở được bài viết" description={error?.message} />;
  return <PostForm key={id} initial={isNew ? null : data!} />;
}

interface FormState {
  title: string;
  slug: string;
  type: PostType;
  status: PostStatus;
  excerpt: string;
  coverUrl: string;
  tags: string;
  contentMd: string;
  publishedAt: string;
}

const IMAGE_FOLDER = 'Ảnh bài viết';

/** Ảnh trong bài viết được gom vào một thư mục riêng ở kho của admin. */
async function imageFolderId(): Promise<string> {
  const { folders } = await apiGet<{ folders: FolderDTO[] }>('/folders');
  const existing = folders.find((f) => f.parentId === null && f.name === IMAGE_FOLDER);
  if (existing) return existing.id;
  return (await apiPost<{ folder: FolderDTO }>('/folders', { name: IMAGE_FOLDER })).folder.id;
}

function PostForm({ initial }: { initial: PostDTO | null }) {
  usePageTitle(initial ? `Sửa: ${initial.title}` : 'Bài viết mới');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [form, setForm] = useState<FormState>({
    title: initial?.title ?? '',
    slug: initial?.slug ?? '',
    type: initial?.type ?? 'post',
    status: initial?.status ?? 'draft',
    excerpt: initial?.excerpt ?? '',
    coverUrl: initial?.coverUrl ?? '',
    tags: initial?.tags.join(', ') ?? '',
    contentMd: initial?.contentMd ?? '',
    publishedAt: toLocalInput(initial?.publishedAt ?? null),
  });
  const [saving, setSaving] = useState(false);
  const [post, setPost] = useState(initial);
  const slugTouched = useRef(!!initial);
  const dirty = useRef(false);
  const base = useRef(initial?.updatedAt);
  const coverInput = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<FormState>) => {
    dirty.current = true;
    setForm((f) => {
      const next = { ...f, ...patch };
      if (patch.title !== undefined && !slugTouched.current) next.slug = slugify(patch.title);
      return next;
    });
  };

  const save = async (status: PostStatus = form.status) => {
    if (!form.title.trim()) {
      toast.error(new Error('Hãy nhập tiêu đề bài viết.'));
      return;
    }
    setSaving(true);
    try {
      const md = await loadMarkdown();
      const body = {
        title: form.title.trim(),
        slug: form.slug.trim(),
        type: form.type,
        status,
        excerpt: form.excerpt,
        coverUrl: form.coverUrl.trim(),
        tags: normalizeTags(form.tags),
        contentMd: form.contentMd,
        contentHtml: md.renderMarkdown(form.contentMd),
        publishedAt: fromLocalInput(form.publishedAt),
      };
      const saved = post
        ? (await apiPatch<{ post: PostDTO }>(`/posts/${post.id}`, { ...body, baseUpdatedAt: base.current })).post
        : (await apiPost<{ post: PostDTO }>('/posts', body)).post;
      dirty.current = false;
      base.current = saved.updatedAt;
      setPost(saved);
      setForm((f) => ({ ...f, slug: saved.slug, status: saved.status, excerpt: saved.excerpt, publishedAt: toLocalInput(saved.publishedAt) }));
      slugTouched.current = true;
      qc.setQueryData(['post', saved.id], saved);
      void qc.invalidateQueries({ queryKey: ['posts'] });
      toast.success(status === 'published' ? 'Đã lưu & xuất bản' : 'Đã lưu bản nháp');
      if (!post) navigate(`/posts/${saved.id}`, { replace: true });
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd + S để lưu.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty.current && currentLocation.pathname !== nextLocation.pathname);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({ title: 'Rời trang?', message: 'Các thay đổi chưa lưu sẽ bị mất.', confirmText: 'Rời trang', danger: true }).then((ok) => {
      if (ok) {
        dirty.current = false;
        blockerRef.current.proceed?.();
      } else {
        blockerRef.current.reset?.();
      }
    });
  }, [blocker.state, confirm]);

  const uploadImage = async (file: File) => {
    const f = await uploadFile(file, { folderId: await imageFolderId(), visibility: 'public' });
    return file.type.startsWith('image/') ? `![${f.name}](${publicFileUrl(f)})` : `[${f.name}](${publicFileUrl(f)})`;
  };

  const uploadCover = async (file: File) => {
    try {
      const f = await uploadFile(file, { folderId: await imageFolderId(), visibility: 'public' });
      set({ coverUrl: publicFileUrl(f) });
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async () => {
    if (!post || !(await confirm({ title: 'Xóa bài viết?', message: 'Bài viết sẽ bị gỡ khỏi blog vĩnh viễn.', confirmText: 'Xóa', danger: true }))) return;
    try {
      await apiDelete(`/posts/${post.id}`);
      dirty.current = false;
      void qc.invalidateQueries({ queryKey: ['posts'] });
      toast.success('Đã xóa bài viết');
      navigate('/posts', { replace: true });
    } catch (err) {
      toast.error(err);
    }
  };

  const path = form.type === 'page' ? `/${form.slug || '…'}` : `/posts/${form.slug || '…'}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/posts" className="mr-auto inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <ArrowLeft className="size-4" /> Bài viết
        </Link>
        {post && (
          <a href={publicPostUrl(post)} target="_blank" rel="noreferrer">
            <Button variant="ghost" icon={<ExternalLink className="size-4" />}>
              {post.status === 'published' ? 'Xem trên blog' : 'Xem trước'}
            </Button>
          </a>
        )}
        {post && (
          <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={remove} className="hover:text-red-600">
            Xóa
          </Button>
        )}
        {form.status === 'published' ? (
          <>
            <Button variant="outline" onClick={() => save('draft')} disabled={saving}>
              Chuyển về nháp
            </Button>
            <Button icon={<Save className="size-4" />} loading={saving} onClick={() => save('published')}>
              Cập nhật
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" icon={<Save className="size-4" />} loading={saving} onClick={() => save('draft')}>
              Lưu nháp
            </Button>
            <Button icon={<Send className="size-4" />} disabled={saving} onClick={() => save('published')}>
              Xuất bản
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <input
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Tiêu đề bài viết"
            maxLength={300}
            className="w-full bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
          />
          <MarkdownEditor
            value={form.contentMd}
            onChange={(contentMd) => set({ contentMd })}
            onUpload={uploadImage}
            placeholder="Nội dung bài viết (Markdown). Dán/kéo-thả ảnh để chèn."
            minHeight={560}
          />
        </div>

        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <Field label="Loại">
              <Select value={form.type} onChange={(e) => set({ type: e.target.value as PostType })}>
                <option value="post">Bài viết (hiện ở trang chủ, RSS)</option>
                <option value="page">Trang tĩnh (Giới thiệu, Liên hệ…)</option>
              </Select>
            </Field>
            <Field label="Đường dẫn (slug)" hint={path}>
              <Input
                value={form.slug}
                onChange={(e) => {
                  slugTouched.current = true;
                  set({ slug: e.target.value });
                }}
                onBlur={() => setForm((f) => ({ ...f, slug: slugify(f.slug) }))}
                placeholder="tu-dong-theo-tieu-de"
              />
            </Field>
            <Field label="Thời gian đăng" hint="Để trống = lúc xuất bản. Chọn thời điểm tương lai để hẹn giờ đăng.">
              <Input type="datetime-local" value={form.publishedAt} onChange={(e) => set({ publishedAt: e.target.value })} />
            </Field>
            <Field label="Thẻ" hint="Cách nhau bởi dấu phẩy">
              <Input value={form.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="cloudflare, ghi chép" />
            </Field>
            <Field label="Tóm tắt" hint="Để trống sẽ tự lấy từ nội dung. Dùng cho SEO & mạng xã hội.">
              <Textarea rows={3} value={form.excerpt} maxLength={1000} onChange={(e) => set({ excerpt: e.target.value })} />
            </Field>
          </Card>

          <Card className="space-y-3 p-4">
            <p className="text-sm font-medium">Ảnh bìa</p>
            {form.coverUrl && <img src={form.coverUrl} alt="" className="aspect-video w-full rounded-lg object-cover" />}
            <Input value={form.coverUrl} onChange={(e) => set({ coverUrl: e.target.value })} placeholder="URL ảnh hoặc tải lên" />
            <Button variant="outline" size="sm" icon={<ImagePlus className="size-4" />} onClick={() => coverInput.current?.click()}>
              Tải ảnh lên
            </Button>
            <input
              ref={coverInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadCover(file);
                e.target.value = '';
              }}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
