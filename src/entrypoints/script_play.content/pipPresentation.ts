// サイトの操作DOMを元documentに残し、映像・コメント・拡張ボタンだけをPiPへ移して復元する。
const VIDEO_STYLE: Readonly<Record<string, string>> = {
  position: 'absolute',
  top: '0',
  right: '0',
  bottom: '0',
  left: '0',
  width: '100%',
  height: '100%',
  'max-width': 'none',
  'max-height': 'none',
  margin: '0',
  'object-fit': 'contain',
  display: 'block',
};

/** 元documentのID参照と操作部品を保ち、失敗・終了時に同じ映像要素を元の位置へ戻す。 */
export const presentVideoInPip = (video: HTMLVideoElement, controls: HTMLElement, target: Window): (() => void) => {
  const source = video.ownerDocument;
  const parent = video.parentElement;
  const controlsParent = controls.parentNode;
  if (!parent || !controlsParent || !target.document.body) throw new Error('PiPへ移す再生領域が見つかりません');
  const originalControls = video.controls;
  const hadStyle = video.hasAttribute('style');
  const originalStyles = Object.keys(VIDEO_STYLE).map((name) => ({
    name,
    value: video.style.getPropertyValue(name),
    priority: video.style.getPropertyPriority(name),
  }));
  const position = source.defaultView?.getComputedStyle(video).position ?? 'static';
  const placeholder = source.createElement('div');
  placeholder.dataset.dCommentsPipPlaceholder = '';
  // サイトのシーク処理が元documentの映像IDから座標を読むため、同じ位置にアンカーを残す。
  if (video.id) placeholder.id = video.id;
  placeholder.textContent = '映像とコメントはPiPで再生中';
  Object.assign(placeholder.style, {
    position,
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    background: '#000',
    color: '#fff',
    font: '14px sans-serif',
    pointerEvents: 'none',
  });

  const stage = target.document.createElement('div');
  stage.id = 'd-comments-pip-player';
  stage.setAttribute('data-d-comments-pip-host', '');
  const layout = target.document.createElement('style');
  // サイトCSSは複製しない。独立した領域でブラウザ標準の再生コントロールを表示する。
  layout.textContent = `
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
    #d-comments-pip-player { position: relative; width: 100%; height: 100%; overflow: hidden; }
  `;
  const overlay = parent.querySelector<HTMLElement>('#d-comments-canvas-container');
  const overlayAnchor = source.createComment('コメント領域の復元位置');
  const controlsAnchor = source.createComment('PiPボタンの復元位置');
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    const currentOverlay = stage.querySelector<HTMLElement>('#d-comments-canvas-container');
    if (placeholder.parentNode) placeholder.replaceWith(video);
    else if (video.parentElement === stage) parent.append(video);
    video.controls = originalControls;
    for (const { name, value, priority } of originalStyles) {
      if (value) video.style.setProperty(name, value, priority);
      else video.style.removeProperty(name);
    }
    if (!hadStyle && !video.style.cssText) video.removeAttribute('style');
    if (currentOverlay) {
      if (overlayAnchor.parentNode) overlayAnchor.replaceWith(currentOverlay);
      else parent.append(currentOverlay);
    } else overlayAnchor.remove();
    if (controlsAnchor.parentNode) controlsAnchor.replaceWith(controls);
    else if (controls.parentElement === stage) controlsParent.appendChild(controls);
    stage.remove();
    layout.remove();
  };

  try {
    if (overlay) overlay.before(overlayAnchor);
    controls.before(controlsAnchor);
    video.replaceWith(placeholder);
    target.document.head.append(layout);
    target.document.body.append(stage);
    stage.append(video);
    if (overlay) stage.append(overlay);
    stage.append(controls);
    for (const [name, value] of Object.entries(VIDEO_STYLE)) video.style.setProperty(name, value);
    video.controls = true;
  } catch (reason) {
    restore();
    throw reason;
  }
  return restore;
};
