import { useEffect, useState } from 'react';

export type MarkdownModule = typeof import('./markdown');

let loaded: MarkdownModule | null = null;
let loading: Promise<MarkdownModule> | null = null;

export function loadMarkdown(): Promise<MarkdownModule> {
  loading ??= import('./markdown').then((m) => (loaded = m));
  return loading;
}

/** Trả về module markdown khi đã tải xong (null trong lúc đang tải). */
export function useMarkdown(): MarkdownModule | null {
  const [mod, setMod] = useState<MarkdownModule | null>(loaded);
  useEffect(() => {
    if (!mod) void loadMarkdown().then(setMod);
  }, [mod]);
  return mod;
}
