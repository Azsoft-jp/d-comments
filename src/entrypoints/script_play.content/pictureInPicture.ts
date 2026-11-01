// 映像を再取得・合成せず、再生中の要素とコメントをDocument PiPへ移して復元する。
type DocumentPictureInPicture = {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
};

const getApi = (): DocumentPictureInPicture | undefined =>
  (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;

/** 移動後のDocumentを描画ループへ知らせ、非表示になった元タブのrAFに依存しない。 */
export const notifyPresentationChange = (video: HTMLVideoElement): void => {
  video.dispatchEvent(new Event('d-comments-presentation-change'));
};

const copyStyles = (source: Document, target: Document): void => {
  const base = target.createElement('base');
  base.href = source.baseURI;
  target.head.append(base);
  for (const sheet of source.styleSheets) {
    if (sheet.disabled) continue;
    // 外部CSS内の相対URLは、そのCSS自身のURLを基準に解決する。
    if (sheet.href) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      link.media = sheet.media.mediaText;
      target.head.append(link);
    } else {
      try {
        const style = target.createElement('style');
        style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
        style.media = sheet.media.mediaText;
        target.head.append(style);
      } catch {
        // 読み取れないスタイルは複製せず、下の最小限の表示スタイルを使う。
      }
    }
  }
  const style = target.createElement('style');
  style.textContent = 'html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }';
  target.head.append(style);
};

/** ユーザーのクリックでのみ小窓を開く。非対応・拒否・閉じる操作を明示的に処理する。 */
export const mountPictureInPicture = (video: HTMLVideoElement): (() => void) => {
  const player = video.parentElement;
  if (!player) return () => {};
  const api = getApi();
  const controls = document.createElement('div');
  controls.id = 'd-comments-pip-controls';
  Object.assign(controls.style, {
    position: 'absolute',
    left: '12px',
    bottom: '12px',
    zIndex: '2147483647',
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    maxWidth: 'calc(100% - 24px)',
    font: '14px sans-serif',
    color: '#fff',
  });
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'コメント付きPiP';
  button.setAttribute('aria-pressed', 'false');
  button.disabled = !api;
  button.title = api ? '映像とコメントを小窓で表示' : 'このブラウザはコメント付きPiPに対応していません';
  Object.assign(button.style, {
    color: '#fff',
    background: '#202020',
    border: '1px solid #fff',
    borderRadius: '0',
    padding: '6px 10px',
    cursor: api ? 'pointer' : 'default',
    flexShrink: '0',
  });
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  Object.assign(status.style, { background: '#202020', whiteSpace: 'normal' });
  controls.append(button, status);
  player.append(controls);

  const originalPosition = player.style.position;
  const addedPosition = getComputedStyle(player).position === 'static';
  if (addedPosition) player.style.position = 'relative';
  let pipWindow: Window | null = null;
  let placeholder: HTMLDivElement | null = null;
  let originalStyle: string | null = null;
  let opening = false;
  let disposed = false;

  const restore = () => {
    if (!placeholder) return;
    placeholder.replaceWith(player);
    placeholder = null;
    if (originalStyle === null) player.removeAttribute('style');
    else player.setAttribute('style', originalStyle);
    pipWindow = null;
    button.textContent = 'コメント付きPiP';
    button.setAttribute('aria-pressed', 'false');
    notifyPresentationChange(video);
  };

  const toggle = async () => {
    if (pipWindow) {
      pipWindow.close();
      restore();
      return;
    }
    if (!api || opening || disposed) return;
    opening = true;
    button.disabled = true;
    status.textContent = '';
    let opened: Window | null = null;
    try {
      // ユーザー操作の直後にrequestWindowを呼び、先行する非同期処理を入れない。
      opened = await api.requestWindow({ width: 640, height: 360 });
      if (disposed || !player.isConnected) {
        opened.close();
        return;
      }
      copyStyles(document, opened.document);
      opened.document.title = 'd-comments コメント付きPiP';
      const rect = player.getBoundingClientRect();
      placeholder = document.createElement('div');
      placeholder.dataset.dCommentsPipPlaceholder = '';
      Object.assign(placeholder.style, { width: `${rect.width}px`, height: `${rect.height}px`, flex: '1 1 auto' });
      player.replaceWith(placeholder);
      originalStyle = player.getAttribute('style');
      Object.assign(player.style, {
        position: 'relative',
        width: '100%',
        height: '100%',
        maxWidth: 'none',
        maxHeight: 'none',
        margin: '0',
        flex: 'none',
      });
      pipWindow = opened;
      pipWindow.addEventListener('pagehide', restore, { once: true });
      pipWindow.document.body.append(player);
      button.textContent = '元の画面に戻す';
      button.setAttribute('aria-pressed', 'true');
      notifyPresentationChange(video);
    } catch {
      // 開けない場合も元画面で視聴を続けられるよう、途中の移動を巻き戻す。
      restore();
      opened?.close();
      status.textContent = 'PiPを開けませんでした。標準PiPや全画面を閉じて、もう一度お試しください。';
    } finally {
      opening = false;
      button.disabled = !api;
    }
  };
  const onClick = (event: MouseEvent) => {
    // ページ側スクリプトのclick()で、拡張の権限を使って勝手に小窓を開かせない。
    if (!event.isTrusted) return;
    void toggle();
  };
  button.addEventListener('click', onClick);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const activeWindow = pipWindow;
    restore();
    activeWindow?.close();
    button.removeEventListener('click', onClick);
    controls.remove();
    if (addedPosition) player.style.position = originalPosition;
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose);
  return dispose;
};
