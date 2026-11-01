// 再生要素とコメント領域を参照し、Document PiPへ移動した後も同じ要素を使う。
const OVERLAY_ID = 'd-comments-canvas-container';
const OVERLAY_STYLE: Record<string, string> = {
  display: 'block',
  height: '100%',
  inset: '0',
  overflow: 'hidden',
  pointerEvents: 'none',
  position: 'absolute',
  width: '100%',
  zIndex: '2',
};

let lastVideo: HTMLVideoElement | null = null;

/** PiP中は元Documentから映像が外れるため、接続中の既存要素も参照する。 */
export function queryVideoElement(): HTMLVideoElement | null {
  const current = document.querySelector<HTMLVideoElement>('video');
  if (current) lastVideo = current;
  return lastVideo?.isConnected ? lastVideo : null;
}

export function mountOverlay(video: HTMLVideoElement): { video: HTMLVideoElement; overlay: HTMLDivElement } {
  const owner = video.ownerDocument;
  const existing = owner.querySelector<HTMLDivElement>(`div#${OVERLAY_ID}`);
  const container = video.parentElement;
  if (existing) {
    if (container && existing.parentElement !== container) container.appendChild(existing);
    return { overlay: existing, video };
  }

  const overlay = owner.createElement('div');
  overlay.id = OVERLAY_ID;
  Object.assign(overlay.style, OVERLAY_STYLE);
  if (!container) owner.body.appendChild(overlay);
  else container.appendChild(overlay);
  return { overlay, video };
}
