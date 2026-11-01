// 映像が属するWindowで描画し、Document PiPへの移動時にrAFの所有先を切り替える。
export type VideoFrameLoop = { start(): void; stop(): void; dispose(): void };

/** 再生速度やシークは呼び出し元がvideo.currentTimeから読み、ここでは描画頻度だけを制御する。 */
export const createVideoFrameLoop = (
  video: HTMLVideoElement,
  draw: (now: number) => void,
  getFps: () => number
): VideoFrameLoop => {
  let active = false;
  let disposed = false;
  let owner: Window | null = null;
  let frameId: number | null = null;
  let lastDraw = Number.NEGATIVE_INFINITY;

  const cancel = () => {
    if (frameId !== null) owner?.cancelAnimationFrame(frameId);
    frameId = null;
  };
  const schedule = () => {
    owner = video.ownerDocument.defaultView;
    if (active && !disposed && owner) frameId = owner.requestAnimationFrame(tick);
  };
  const tick = () => {
    frameId = null;
    if (!active || disposed) return;
    const now = performance.now();
    const configuredFps = getFps();
    const fps = Number.isFinite(configuredFps) ? Math.min(120, Math.max(1, configuredFps)) : 60;
    if (now - lastDraw >= 1000 / fps) {
      lastDraw = now;
      draw(now);
    }
    schedule();
  };
  const switchWindow = () => {
    cancel();
    lastDraw = Number.NEGATIVE_INFINITY;
    schedule();
  };
  video.addEventListener('d-comments-presentation-change', switchWindow);

  const stop = () => {
    active = false;
    cancel();
  };
  return {
    start() {
      if (active || disposed) return;
      active = true;
      lastDraw = Number.NEGATIVE_INFINITY;
      schedule();
    },
    stop,
    dispose() {
      disposed = true;
      stop();
      video.removeEventListener('d-comments-presentation-change', switchWindow);
    },
  };
};
