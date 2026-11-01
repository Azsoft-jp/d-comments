// 同じ取得元の再取得と、異なる取得元で共有されるスレッドの重複を検証する。
import { describe, expect, it, vi } from 'vitest';
import { addPlayingVideo, createCommentManager, flattenComments, getThreads } from '../../src/modules/comments/manager';
import type { NvCommentItem, Threads } from '../../src/types/api';
import type { CommentVideoData } from '../../src/types/comments';

vi.mock('../../src/config/storage', () => ({ getConfig: vi.fn<() => void>() }));
vi.mock('../../src/modules/comments/service', () => ({ createCommentService: vi.fn<() => void>() }));

const comment = (id: string, overrides: Partial<NvCommentItem> = {}): NvCommentItem => ({
  id,
  no: 1,
  vposMs: 1000,
  body: '合成テストコメント',
  commands: [],
  userId: 'synthetic',
  isPremium: false,
  score: 0,
  postedAt: '2026-01-01T00:00:00Z',
  nicoruCount: 0,
  nicoruId: null,
  source: 'trunk',
  isMyPost: false,
  ...overrides,
});
const thread = (comments: NvCommentItem[], overrides: Partial<Threads[number]> = {}): Threads[number] => ({
  id: 123,
  fork: 'main',
  commentCount: 100,
  comments,
  ...overrides,
});
const video = (contentId: string, threads: Threads): CommentVideoData => ({
  date: 0,
  threads,
  videoData: {
    contentId,
    title: '合成動画',
    description: '',
    commentCounter: 100,
    viewCounter: 0,
    lengthSeconds: 60,
    isDAnime: false,
    thumbnailUrl: '',
  },
});

describe('共有スレッドのコメント', () => {
  it('2動画が同じスレッドを返しても、コメントを一度だけ表示する', () => {
    let manager = createCommentManager();
    manager = addPlayingVideo(manager, video('so1', [thread([comment('9007199254740993')])]));
    manager = addPlayingVideo(
      manager,
      video('so2', [thread([comment('9007199254740993'), comment('9007199254740994', { no: 2 })])])
    );
    const threads = getThreads(manager);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.comments.map((item) => item.id)).toEqual(['9007199254740993', '9007199254740994']);
    expect(threads[0]?.commentCount).toBe(100);
    expect(manager.playing).toHaveLength(2);
  });

  it('同じ本文・同じ時刻でもID、スレッド、forkが違う投稿を残す', () => {
    const threads = [
      thread([comment('1'), comment('2')]),
      thread([comment('1')], { id: 456 }),
      thread([comment('1')], { fork: 'owner' }),
    ];
    expect(flattenComments(threads, ['main', 'owner'])).toHaveLength(4);
  });

  it('同一レスポンス内の重複も除き、入力を書き換えない', () => {
    const threads = [thread([comment('1'), comment('1'), comment('2')])];
    const original = structuredClone(threads);
    const flattened = flattenComments(threads, ['main']);
    expect(flattened).toHaveLength(2);
    const first = flattened[0];
    if (first) first.commands.push('ue');
    expect(threads).toEqual(original);
  });

  it('同じ動画の再追加は置換し、取得済み件数を水増ししない', () => {
    let manager = addPlayingVideo(createCommentManager(), video('so1', [thread([comment('1')])]));
    manager = addPlayingVideo(manager, video('so1', [thread([comment('2')])]));
    expect(manager.playing).toHaveLength(1);
    expect(getThreads(manager)[0]?.comments.map((item) => item.id)).toEqual(['2']);
    expect(flattenComments([], ['main'])).toEqual([]);
  });
});
