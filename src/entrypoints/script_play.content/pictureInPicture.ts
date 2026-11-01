// 映像を再取得・合成せず、再生中の要素とコメントをDocument PiPへ移して復元する。
import { logger } from '@/lib/logger';
import { type PipMediaSession, registerAutomaticPictureInPicture } from './automaticPictureInPicture';
import { presentVideoInPip } from './pipPresentation';

type DocumentPictureInPicture = {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
};

const getApi = (): DocumentPictureInPicture | undefined =>
  (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;

/** 移動後のDocumentを描画ループへ知らせ、非表示になった元タブのrAFに依存しない。 */
export const notifyPresentationChange = (video: HTMLVideoElement): void => {
  video.dispatchEvent(new Event('d-comments-presentation-change'));
};

/** 小窓を表す自作SVGを使い、外部画像の取得なしでボタンの役割を示す。 */
const createPipIcon = (): SVGSVGElement => {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '22');
  icon.setAttribute('height', '22');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const frame = document.createElementNS(namespace, 'rect');
  for (const [name, value] of Object.entries({
    x: '2',
    y: '4',
    width: '20',
    height: '16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
  }))
    frame.setAttribute(name, value);
  const inset = document.createElementNS(namespace, 'rect');
  for (const [name, value] of Object.entries({ x: '12', y: '12', width: '8', height: '6', fill: 'currentColor' }))
    inset.setAttribute(name, value);
  icon.append(frame, inset);
  return icon;
};

/** ボタン操作またはブラウザのPiP通知で開く。ページの合成クリックからは起動しない。 */
export const mountPictureInPicture = (video: HTMLVideoElement): (() => void) => {
  const player = video.parentElement;
  if (!player) return () => {};
  const api = getApi();
  const hostAttribute = 'data-d-comments-pip-host';
  const previousHostAttribute = player.getAttribute(hostAttribute);
  player.setAttribute(hostAttribute, '');
  const controls = document.createElement('div');
  controls.id = 'd-comments-pip-controls';
  Object.assign(controls.style, {
    position: 'absolute',
    right: '12px',
    top: '12px',
    zIndex: '2147483647',
    display: 'flex',
    gap: '8px',
    flexDirection: 'column',
    alignItems: 'flex-end',
    maxWidth: 'calc(100% - 24px)',
    font: '14px sans-serif',
    color: '#fff',
    pointerEvents: 'none',
  });
  // 透明な間はクリックを遮らず、キーボードのフォーカスは受け取れる状態にする。
  const controlsStyle = document.createElement('style');
  controlsStyle.textContent = `
    #d-comments-pip-button { opacity: 0; pointer-events: none; }
    [data-d-comments-pip-host]:hover > #d-comments-pip-controls > #d-comments-pip-button,
    #d-comments-pip-button:focus-visible { opacity: 1; pointer-events: auto; }
    #d-comments-pip-button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  `;
  const button = document.createElement('button');
  button.id = 'd-comments-pip-button';
  button.type = 'button';
  button.disabled = !api;
  const label = document.createElement('span');
  button.append(createPipIcon(), label);
  Object.assign(button.style, {
    color: '#fff',
    background: '#202020',
    border: '1px solid #fff',
    borderRadius: '0',
    padding: '6px 10px',
    cursor: api ? 'pointer' : 'default',
    flexShrink: '0',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '40px',
    font: 'inherit',
  });
  // 見た目の短いラベルと、支援技術向けの具体的な操作名を同時に更新する。
  const updateButton = (inPip: boolean) => {
    label.textContent = inPip ? '戻す' : 'PiP';
    button.setAttribute('aria-label', inPip ? '元の画面に戻す' : 'コメント付きPiP');
    button.setAttribute('aria-pressed', String(inPip));
    button.title = !api
      ? 'このブラウザはコメント付きPiPに対応していません'
      : inPip
        ? '元の画面に戻す'
        : 'Document PiPで映像とコメントを小窓に表示';
  };
  updateButton(false);
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  Object.assign(status.style, { background: '#202020', whiteSpace: 'normal' });
  controls.append(controlsStyle, button, status);
  player.append(controls);

  const originalPosition = player.style.position;
  const addedPosition = getComputedStyle(player).position === 'static';
  if (addedPosition) player.style.position = 'relative';
  let pipWindow: Window | null = null;
  let restorePresentation: (() => void) | null = null;
  let opening = false;
  let disposed = false;

  const restore = () => {
    const restoreDom = restorePresentation;
    restorePresentation = null;
    pipWindow = null;
    if (!restoreDom) return;
    restoreDom();
    updateButton(false);
    notifyPresentationChange(video);
  };

  const openPip = async () => {
    // 自動通知と手動操作が重なっても、既存の小窓を閉じたり重複生成したりしない。
    if (!api || pipWindow || opening || disposed) return;
    // 標準PiPの後追い変換は起動制約があるため、既存の視聴を保って手動操作を案内する。
    if (video.ownerDocument.pictureInPictureElement) {
      status.textContent = '標準PiPが開いています。閉じてから「PiP」ボタンを押してください。';
      return;
    }
    opening = true;
    button.disabled = true;
    status.textContent = '';
    let opened: Window | null = null;
    try {
      // ボタン操作またはブラウザ通知の直後に要求し、先行する非同期処理を入れない。
      opened = await api.requestWindow({ width: 640, height: 360 });
      if (disposed || !player.isConnected) {
        opened.close();
        return;
      }
      opened.document.title = 'd-comments コメント付きPiP';
      pipWindow = opened;
      pipWindow.addEventListener('pagehide', restore, { once: true });
      restorePresentation = presentVideoInPip(video, controls, pipWindow);
      updateButton(true);
      notifyPresentationChange(video);
    } catch (reason) {
      // 開けない場合も元画面で視聴を続けられるよう、途中の移動を巻き戻す。
      logger.warn('コメント付きPiPを開けませんでした。', reason);
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
    if (pipWindow) {
      pipWindow.close();
      restore();
    } else void openPip();
  };
  button.addEventListener('click', onClick);

  const automaticPip = registerAutomaticPictureInPicture(
    api ? (navigator.mediaSession as unknown as PipMediaSession | undefined) : undefined,
    () => {
      void openPip();
    },
    (reason) => logger.warn('自動PiPを登録できませんでした。手動のPiPボタンをご利用ください。', reason)
  );
  // サイトが再生に伴って標準PiPを登録する場合に備え、再生イベントでも接続し直す。
  video.addEventListener('play', automaticPip.refresh);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    video.removeEventListener('play', automaticPip.refresh);
    automaticPip.dispose();
    const activeWindow = pipWindow;
    restore();
    activeWindow?.close();
    button.removeEventListener('click', onClick);
    controls.remove();
    if (previousHostAttribute === null) player.removeAttribute(hostAttribute);
    else player.setAttribute(hostAttribute, previousHostAttribute);
    if (addedPosition) player.style.position = originalPosition;
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose);
  return dispose;
};
