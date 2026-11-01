// 複数動画から共有されるスレッドを統合し、表示用データの重複を取り除く。
import type { Threads } from '@/types/api';

/** 同じスレッド・fork・投稿IDだけをまとめ、同文の別投稿は保持する。入力は変更しない。 */
export const mergeCommentThreads = (threads: Threads): Threads => {
  const merged = new Map<string, { thread: Threads[number]; ids: Set<string> }>();
  for (const source of threads) {
    const key = `${source.id}:${source.fork}`;
    let entry = merged.get(key);
    if (!entry) {
      entry = { thread: { ...source, comments: [] }, ids: new Set() };
      merged.set(key, entry);
    }
    entry.thread.commentCount = Math.max(entry.thread.commentCount, source.commentCount);
    for (const comment of source.comments) {
      // 投稿IDは64bit整数の文字列なので、Numberへ変換して精度を落とさない。
      const id = comment.id ? `id:${comment.id}` : `no:${comment.no}`;
      if (entry.ids.has(id)) continue;
      entry.ids.add(id);
      entry.thread.comments.push(structuredClone(comment));
    }
  }
  return [...merged.values()].map(({ thread }) => thread);
};
