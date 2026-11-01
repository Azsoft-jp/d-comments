// Chromeの自動PiP通知だけを接続し、起動の許可と適格条件の判定はブラウザに任せる。
// DOM型に未収録のアクションなので、使用するメソッドの契約だけを限定して定義する。
export type PipMediaSession = {
  setActionHandler(action: 'enterpictureinpicture', handler: (() => void) | null): void;
};

export type AutomaticPipRegistration = { refresh: () => void; dispose: () => void };

/** 再生時に接続を更新できるようにし、非対応の登録失敗を無限に再試行しない。 */
export const registerAutomaticPictureInPicture = (
  session: PipMediaSession | undefined,
  open: () => void,
  onError: (reason: unknown) => void
): AutomaticPipRegistration => {
  let disposed = false;
  let installed = false;
  let unsupported = false;
  const handler = () => {
    if (!disposed) open();
  };
  const refresh = () => {
    if (!session || disposed || unsupported) return;
    try {
      session.setActionHandler('enterpictureinpicture', handler);
      installed = true;
    } catch (reason) {
      unsupported = true;
      onError(reason);
    }
  };
  refresh();
  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!session || !installed) return;
      try {
        session.setActionHandler('enterpictureinpicture', null);
      } catch (reason) {
        onError(reason);
      }
    },
  };
};
