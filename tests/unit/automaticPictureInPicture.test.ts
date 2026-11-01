// サイト側の既存PiPハンドラーを置き換え、再生・停止などの操作には触れないことを検証する。
import { describe, expect, it, vi } from 'vitest';
import {
  type PipMediaSession,
  registerAutomaticPictureInPicture,
} from '../../src/entrypoints/script_play.content/automaticPictureInPicture';

describe('ブラウザの自動PiP通知', () => {
  it('PiP通知だけをコメント付きPiPへ接続し、登録時には開かない', () => {
    const sitePip = vi.fn<() => void>();
    const play = vi.fn<() => void>();
    const handlers = new Map<string, (() => void) | null>([
      ['enterpictureinpicture', sitePip],
      ['play', play],
    ]);
    const session: PipMediaSession = {
      setActionHandler: (action, handler) => {
        handlers.set(action, handler);
      },
    };
    const open = vi.fn<() => void>();
    const error = vi.fn<(reason: unknown) => void>();
    const registration = registerAutomaticPictureInPicture(session, open, error);
    expect(open).not.toHaveBeenCalled();
    handlers.get('enterpictureinpicture')?.();
    expect(open).toHaveBeenCalledOnce();
    expect(sitePip).not.toHaveBeenCalled();
    expect(handlers.get('play')).toBe(play);

    // サイトが再生時に登録し直しても、次の再生で接続を更新できる。
    handlers.set('enterpictureinpicture', sitePip);
    registration.refresh();
    const callback = handlers.get('enterpictureinpicture');
    callback?.();
    expect(open).toHaveBeenCalledTimes(2);
    registration.dispose();
    registration.dispose();
    registration.refresh();
    callback?.();
    expect(open).toHaveBeenCalledTimes(2);
    expect(handlers.get('enterpictureinpicture')).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('非対応なら理由を通知し、同じ登録を繰り返し試さない', () => {
    const reason = new TypeError('合成した未対応エラー');
    const setActionHandler = vi.fn<PipMediaSession['setActionHandler']>(() => {
      throw reason;
    });
    const open = vi.fn<() => void>();
    const error = vi.fn<(reason: unknown) => void>();
    const registration = registerAutomaticPictureInPicture({ setActionHandler }, open, error);
    registration.refresh();
    registration.dispose();
    expect(setActionHandler).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it('Media Sessionが存在しなければ何も登録しない', () => {
    const open = vi.fn<() => void>();
    const error = vi.fn<(reason: unknown) => void>();
    const registration = registerAutomaticPictureInPicture(undefined, open, error);
    registration.refresh();
    registration.dispose();
    expect(open).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
