// 元タブとPiPのrAFを模擬し、切替・停止・二重起動でループが残らないことを確認する。
import { describe, expect, it, vi } from 'vitest';
import { createVideoFrameLoop } from '../../src/entrypoints/script_play.content/renderer/frameLoop';

const createWindow = () => {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const owner = {
    requestAnimationFrame: vi.fn<(callback: FrameRequestCallback) => number>((callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    }),
    cancelAnimationFrame: vi.fn<(id: number) => boolean>((id) => callbacks.delete(id)),
  } as unknown as Window;
  return {
    owner,
    callbacks,
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    },
  };
};

describe('PiPの描画時計', () => {
  it('移動先Windowへ切り替え、閉じると元Windowへ戻る', () => {
    const source = createWindow();
    const pip = createWindow();
    const doc = { defaultView: source.owner };
    const video = Object.assign(new EventTarget(), { ownerDocument: doc }) as unknown as HTMLVideoElement;
    const draw = vi.fn<(now: number) => void>();
    const loop = createVideoFrameLoop(video, draw, () => 60);
    loop.start();
    loop.start();
    expect(source.callbacks.size).toBe(1);
    source.flush();
    expect(draw).toHaveBeenCalledOnce();

    doc.defaultView = pip.owner;
    video.dispatchEvent(new Event('d-comments-presentation-change'));
    expect(source.callbacks.size).toBe(0);
    expect(pip.callbacks.size).toBe(1);
    pip.flush();
    expect(draw).toHaveBeenCalledTimes(2);

    doc.defaultView = source.owner;
    video.dispatchEvent(new Event('d-comments-presentation-change'));
    expect(pip.callbacks.size).toBe(0);
    expect(source.callbacks.size).toBe(1);
    loop.dispose();
    video.dispatchEvent(new Event('d-comments-presentation-change'));
    loop.start();
    expect(source.callbacks.size).toBe(0);
  });

  it('停止中は移動しても起動せず、再開時は現在のWindowで描く', () => {
    const source = createWindow();
    const pip = createWindow();
    const doc = { defaultView: source.owner };
    const video = Object.assign(new EventTarget(), { ownerDocument: doc }) as unknown as HTMLVideoElement;
    const draw = vi.fn<(now: number) => void>();
    const loop = createVideoFrameLoop(video, draw, () => Number.NaN);
    loop.start();
    loop.stop();
    doc.defaultView = pip.owner;
    video.dispatchEvent(new Event('d-comments-presentation-change'));
    expect(pip.callbacks.size).toBe(0);
    loop.start();
    pip.flush();
    expect(draw).toHaveBeenCalledOnce();
    loop.dispose();
    expect(pip.callbacks.size).toBe(0);
  });
});
