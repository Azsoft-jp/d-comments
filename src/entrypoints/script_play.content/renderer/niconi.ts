// 既存のコメント描画を管理し、映像と同じWindowで描画を継続する。
import type { Options, V1Thread } from '@xpadev-net/niconicomments';
import NiconiComments from '@xpadev-net/niconicomments';
import { getConfig, watchConfig } from '@/config/storage';
import type { Result } from '@/lib/types';
import type { Threads } from '@/types/api';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './core/constants';
import { mountOverlay, queryVideoElement } from './core/dom';
import { createVideoFrameLoop } from './frameLoop';
import type { RendererController } from './types';

export const createNiconiRenderer = async (): Promise<Result<RendererController, string>> => {
  const video = queryVideoElement();
  if (!video) return { error: 'Video element not found', ok: false };

  const { overlay } = mountOverlay(video);
  let canvas = overlay.querySelector<HTMLCanvasElement>('#d-comments-canvas');
  if (!canvas) {
    canvas = video.ownerDocument.createElement('canvas');
    canvas.id = 'd-comments-canvas';
  }
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  Object.assign(canvas.style, {
    display: 'block',
    height: '100%',
    left: '0',
    objectFit: 'contain',
    pointerEvents: 'none',
    position: 'absolute',
    top: '0',
    width: '100%',
    zIndex: '2',
  });
  if (canvas.parentElement !== overlay) overlay.appendChild(canvas);

  const initialOpacity = await getConfig('comment_area_opacity_percentage');
  const initialScale = await getConfig('nicoarea_scale');
  const initialFps = await getConfig('comment_renderer_fps');
  const initialOffset = await getConfig('comment_timing_offset');
  const initialVisibility = await getConfig('show_comments_in_niconico_style');

  let offsetMs = initialOffset;
  let isVisible = initialVisibility;
  const options: Options = { format: 'v1', keepCA: true, scale: Math.max(initialScale / 100, 0) };
  const clampFps = (value: number) => Math.min(120, Math.max(15, Math.round(Number.isFinite(value) ? value : 60)));
  let targetFps = clampFps(initialFps);

  canvas.style.opacity = (initialOpacity / 100).toString();
  canvas.style.display = isVisible ? 'block' : 'none';
  overlay.style.display = isVisible ? 'block' : 'none';

  let renderer: NiconiComments | null = null;
  let rendererReady = false;
  let currentThreads: Threads = [];
  let disposed = false;
  let forceDraw = true;
  const onPresentationChange = () => {
    forceDraw = true;
  };
  video.addEventListener('d-comments-presentation-change', onPresentationChange);

  const tick = (): number => {
    if (disposed) return 0;
    if (!renderer) return 0;
    // PiPへ移動した映像は元DocumentのquerySelectorでは見つからない。
    const videoNow = video.isConnected ? video : queryVideoElement();
    if (!videoNow) return 0;
    if (!canvas.isConnected) {
      frameLoop.stop();
      return 0;
    }
    if (rendererReady && renderer) {
      const vpos = Math.max(0, Math.floor((videoNow.currentTime * 1000 + offsetMs) / 10));
      // 移動直後は同じ再生時刻でも再描画し、描画済み判定で空のままにしない。
      renderer.drawCanvas(vpos, forceDraw);
      forceDraw = false;
    }
    return 1;
  };
  const frameLoop = createVideoFrameLoop(video, tick, () => targetFps);

  const clearRenderer = () => {
    frameLoop.stop();
    if (renderer) renderer.clear();
    renderer = null;
    rendererReady = false;
  };

  const rebuild = () => {
    if (!isVisible || currentThreads.length === 0) return clearRenderer();
    clearRenderer();
    if (!canvas.isConnected) return;
    // 別Windowのcanvasはinstanceofに通らないため、描画Adapterを明示して渡す。
    const adapter = NiconiComments.internal.renderer.createRenderer(canvas);
    renderer = new NiconiComments(adapter, currentThreads as V1Thread[], options);
    rendererReady = true;
    forceDraw = true;
    frameLoop.start();
  };

  const applyVisibility = (visible: boolean) => {
    isVisible = visible;
    canvas.style.display = visible ? 'block' : 'none';
    overlay.style.display = visible ? 'block' : 'none';
    (visible ? rebuild : clearRenderer)();
  };

  const stops: (() => void)[] = [];
  stops.push(
    watchConfig('comment_area_opacity_percentage', (value) => {
      canvas.style.opacity = (value / 100).toString();
    })
  );
  stops.push(
    watchConfig('nicoarea_scale', (value) => {
      options.scale = Math.max(value / 100, 0);
      rebuild();
    })
  );
  stops.push(
    watchConfig('comment_renderer_fps', (value) => {
      targetFps = clampFps(value);
    })
  );
  stops.push(
    watchConfig('show_comments_in_niconico_style', (value) => {
      applyVisibility(value);
    })
  );
  stops.push(
    watchConfig('comment_timing_offset', (value) => {
      offsetMs = value;
    })
  );

  const setThreads = (threads: Threads): Threads => {
    currentThreads = threads;
    rebuild();
    return currentThreads;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    frameLoop.dispose();
    video.removeEventListener('d-comments-presentation-change', onPresentationChange);
    clearRenderer();
    for (const stop of stops) stop();
    canvas.remove();
    overlay.style.display = 'none';
  };

  return { ok: true, value: { dispose, setThreads } };
};
