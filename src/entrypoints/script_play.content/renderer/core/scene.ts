// コメント専用の透過シーンを作る。描画の起動と停止は呼び出し元が管理する。
import { Application, Container } from 'pixi.js';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from './constants';

export type PixiScene = { app: Application; layer: Container };

export async function createPixiScene(overlay: HTMLElement): Promise<PixiScene> {
  const app = new Application();
  await app.init({
    canvas: overlay.ownerDocument.createElement('canvas'),
    autoStart: false,
    antialias: true,
    autoDensity: true,
    backgroundAlpha: 0,
    height: CANVAS_HEIGHT,
    preference: 'webgpu',
    width: CANVAS_WIDTH,
  });
  app.ticker.maxFPS = 60;
  app.stage.eventMode = 'none';
  app.stage.interactiveChildren = false;

  overlay.appendChild(app.canvas);
  Object.assign(app.canvas.style, {
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

  const layer = new Container();
  layer.eventMode = 'none';
  layer.interactiveChildren = false;
  app.stage.addChild(layer);

  return { app, layer };
}
