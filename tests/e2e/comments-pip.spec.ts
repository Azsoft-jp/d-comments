// 認証や実番組を使わず、合成映像と共有スレッドで拡張の表示・PiP往復を検証する。
import { readFileSync } from 'node:fs';
import { expect, type Page, type Route } from '@playwright/test';
import type { CommentVideoData } from '../../src/types/comments';
import { type ExtensionFixtures, test } from './fixtures';

const viewingUrl = 'https://animestore.docomo.ne.jp/animestore/sc_d_pc?partId=00000001';
const syntheticVideo = readFileSync(new URL('../fixtures/solid-blue.webm', import.meta.url));

// Chromiumが有限のシーク範囲を認識できるよう、合成映像にもRange応答を返す。
const serveSyntheticVideo = async (route: Route): Promise<void> => {
  const range = route
    .request()
    .headers()
    .range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : syntheticVideo.length - 1;
  const headers: Record<string, string> = { 'Accept-Ranges': 'bytes' };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${syntheticVideo.length}`;
  await route.fulfill({
    status: range ? 206 : 200,
    contentType: 'video/webm',
    headers,
    body: syntheticVideo.subarray(start, end + 1),
  });
};

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>合成テスト</title>
<meta name="Description" content="許諾不要の合成素材">
<style>body { margin: 0; } #host { width: 960px; height: 540px; }
#player { position: relative; width: 100%; height: 100%; min-width: 0; flex: 1; }
video { width: 100%; height: 100%; object-fit: contain; }</style></head>
<body><div id="host"><div id="player"><video id="video" src="/synthetic-video.webm" autoplay muted playsinline loop></video>
<div id="site-controls" style="position:absolute;bottom:0;left:0;z-index:5;background:white">
<button id="site-play">サイトの再生・停止</button><button id="site-seek">サイトのシーク</button>
<button id="site-volume">サイトの音量</button><button id="site-rate">サイトの速度</button>
<span id="site-state">状態</span><span id="site-popup"><span>シーク状態</span></span>
</div></div></div>
<script>
// サイトが映像を保持し、元のdocumentから操作部品と座標を読む構造を模擬する。
const video = document.getElementById('video');
document.getElementById('site-play').addEventListener('click', () => {
  document.getElementById('site-state').classList.toggle('active');
  if (video.paused) video.play(); else video.pause();
});
document.getElementById('site-seek').addEventListener('click', () => {
  if (document.getElementById('video').getBoundingClientRect().width <= 0) throw new Error('映像の座標が不明');
  document.getElementById('site-popup').childNodes[0].textContent = 'シーク済み';
  video.currentTime = video.currentTime >= 3 ? 1 : 4;
});
document.getElementById('site-volume').addEventListener('click', () => { video.volume = video.volume === 0.4 ? 0.7 : 0.4; });
document.getElementById('site-rate').addEventListener('click', () => { video.playbackRate = video.playbackRate === 1.5 ? 1 : 1.5; });
</script></body></html>`;

const videoData = (contentId: string, vposMs: number): CommentVideoData => ({
  date: 0,
  videoData: {
    contentId,
    title: '合成動画',
    description: '',
    commentCounter: 1,
    viewCounter: 0,
    lengthSeconds: 60,
    isDAnime: false,
    thumbnailUrl: '',
  },
  threads: [
    {
      id: 123,
      fork: 'main',
      commentCount: 1,
      comments: [
        {
          id: '9007199254740993',
          no: 1,
          vposMs,
          body: '合成コメント PiP',
          commands: ['@60'],
          userId: 'synthetic',
          isPremium: false,
          score: 0,
          postedAt: '2026-01-01T00:00:00Z',
          nicoruCount: 0,
          nicoruId: null,
          source: 'trunk',
          isMyPost: false,
        },
      ],
    },
  ],
});

// 元documentの操作部品から、同じ映像に対して再生・停止・シーク・音量・速度を変更する。
const checkSiteControls = async (source: Page, media: Page): Promise<void> => {
  await source.bringToFront();
  const video = media.locator('video');
  const paused = await video.evaluate((element: HTMLVideoElement) => element.paused);
  await source.getByRole('button', { name: 'サイトの再生・停止' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(!paused);
  await source.getByRole('button', { name: 'サイトの再生・停止' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(paused);
  // シーク位置を正確に比較する間だけ、サイト側の操作で一時停止する。
  if (!paused) {
    await source.getByRole('button', { name: 'サイトの再生・停止' }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  }
  const state = await video.evaluate((element: HTMLVideoElement) => ({
    time: element.currentTime,
    volume: element.volume,
    rate: element.playbackRate,
  }));
  await source.getByRole('button', { name: 'サイトのシーク' }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBe(state.time >= 3 ? 1 : 4);
  await expect(source.locator('#site-popup')).toHaveText('シーク済み');
  await source.getByRole('button', { name: 'サイトの音量' }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.volume))
    .toBe(state.volume === 0.4 ? 0.7 : 0.4);
  await source.getByRole('button', { name: 'サイトの速度' }).click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.playbackRate))
    .toBe(state.rate === 1.5 ? 1 : 1.5);
  if (!paused) {
    await source.getByRole('button', { name: 'サイトの再生・停止' }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  }
};

// 実APIへの登録を記録し、Chrome自身の自動起動判定とは分けて通知後の経路を検証する。
const captureBrowserPipTrigger = async (
  extension: ExtensionFixtures['extension'],
  page: Page
): Promise<{ request: () => Promise<void>; dispose: () => Promise<void> }> => {
  const session = await extension.context.newCDPSession(page);
  const contexts: number[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => {
    contexts.push(context.id);
  });
  await session.send('Runtime.enable');
  let extensionContext: number | undefined;
  for (const contextId of contexts) {
    const result = await session.send('Runtime.evaluate', {
      contextId,
      expression: 'globalThis.chrome?.runtime?.id',
      userGesture: false,
    });
    if (result.result.value === extension.id) extensionContext = contextId;
  }
  expect(extensionContext).toBeDefined();
  const instrumentation = await session.send('Runtime.evaluate', {
    contextId: extensionContext,
    expression: `(() => {
      const mediaSession = navigator.mediaSession;
      const original = mediaSession.setActionHandler.bind(mediaSession);
      mediaSession.setActionHandler = (action, handler) => {
        original(action, handler);
        if (action === 'enterpictureinpicture') globalThis.__testPipHandler = handler;
      };
      // サイト側の標準PiP登録が後から行われた状態を模擬する。
      mediaSession.setActionHandler('enterpictureinpicture', () => {
        document.querySelector('video').requestPictureInPicture();
      });
    })()`,
  });
  expect(instrumentation.exceptionDetails).toBeUndefined();
  await page.locator('video').evaluate(async (element) => {
    const video = element as HTMLVideoElement;
    video.pause();
    await video.play();
  });
  return {
    async request() {
      const result = await session.send('Runtime.evaluate', {
        contextId: extensionContext,
        expression: 'globalThis.__testPipHandler()',
        userGesture: false,
      });
      expect(result.exceptionDetails).toBeUndefined();
    },
    dispose: () => session.detach(),
  };
};

for (const newRenderer of [false, true]) {
  test(`共有コメントは1件になり、PiPへ往復できる (${newRenderer ? 'Pixi' : 'Niconi'})`, async ({
    extension,
    extensionPage,
  }) => {
    const unexpectedRequests: string[] = [];
    await extension.context.route('https://**/*', async (route) => {
      const url = route.request().url();
      if (url === viewingUrl) return route.fulfill({ contentType: 'text/html', body: html });
      if (url.endsWith('/synthetic-video.webm')) return serveSyntheticVideo(route);
      if (url.includes('/rest/WS010105?'))
        return route.fulfill({
          json: {
            version: 1,
            data: { title: '合成テスト', workTitle: '合成テスト', partExp: '合成素材' },
          },
        });
      if (url.endsWith('/favicon.ico')) return route.fulfill({ status: 204 });
      unexpectedRequests.push(url);
      return route.abort();
    });
    await extensionPage.goto(`chrome-extension://${extension.id}/usage.html`);
    await extensionPage.evaluate(async (enabled) => {
      const extensionApi = (globalThis as unknown as { chrome: typeof browser }).chrome;
      await extensionApi.storage.local.set({ enable_auto_play: false, use_new_renderer: enabled });
    }, newRenderer);

    const page = await extension.context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(viewingUrl);
    const button = page.getByRole('button', { name: 'コメント付きPiP', exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveText('PiP');
    await expect(button.locator('svg')).toBeVisible();
    // 再生領域を離れたら消え、領域内へ戻るとボタン全体を操作できる。
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('検証用の画面サイズを取得できません');
    await page.bringToFront();
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    await expect(button).toHaveCSS('opacity', '0');
    await expect(button).toHaveCSS('pointer-events', 'none');
    await page.locator('#player').hover();
    await expect(button).toHaveCSS('opacity', '1');
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    await expect(button).toHaveCSS('opacity', '0');
    await expect
      .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0);
    await checkSiteControls(page, page);
    const vpos = await page
      .locator('video')
      .evaluate((video: HTMLVideoElement) => Math.floor(video.currentTime * 1000) - 20_000);
    const add = async (data: CommentVideoData) =>
      extensionPage.evaluate(
        async ({ url, video }) => {
          const extensionApi = (globalThis as unknown as { chrome: typeof browser }).chrome;
          const tabs = await extensionApi.tabs.query({ url });
          const result: unknown = await extensionApi.runtime.sendMessage({
            type: 'add_video',
            payload: { tabId: tabs[0]?.id, video },
          });
          return result;
        },
        { url: viewingUrl, video: data }
      );
    await add(videoData('so1', vpos));
    await add(videoData('so2', vpos));
    await expect(page.getByText('コメント: 1', { exact: true })).toBeVisible();
    await expect(page.locator('#d-comments-canvas-container canvas')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('source.png') });

    // Document PiPは実ブラウザAPIを使い、動画の複製や再取得がないことを確認する。
    const browserPip = newRenderer ? await captureBrowserPipTrigger(extension, page) : undefined;
    if (!browserPip) {
      // キーボードだけでも、コメント付きPiPを起動できる。
      for (let index = 0; index < 10; index++) {
        if (await button.evaluate((element) => document.activeElement === element)) break;
        await page.keyboard.press('Tab');
      }
      await expect(button).toBeFocused();
      await expect(button).toHaveCSS('opacity', '1');
    }
    const popup = extension.context.waitForEvent('page');
    if (browserPip) await browserPip.request();
    else await page.keyboard.press('Enter');
    const pip = await popup;
    if (browserPip) {
      // 同じ通知を再受信しても、開いているコメント付き小窓を閉じない。
      await browserPip.request();
      await browserPip.dispose();
    }
    // 元documentを参照するサイト操作部品を、小窓へ移動させない。
    await expect(page.locator('#site-controls')).toBeVisible();
    await expect(pip.locator('#site-controls')).toHaveCount(0);
    await expect(pip.locator('#d-comments-pip-player video')).toHaveCount(1);
    await expect(pip.locator('#d-comments-canvas-container canvas')).toHaveCount(1);
    await expect(page.locator('video')).toHaveCount(0);
    await expect(pip.getByRole('button', { name: '元の画面に戻す' })).toBeVisible();
    await expect(pip.getByRole('button', { name: '元の画面に戻す' })).toHaveText('戻す');
    await expect.poll(() => pip.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);
    await expect(pip.locator('video')).toHaveJSProperty('controls', true);
    await checkSiteControls(page, pip);
    // 小窓内はブラウザ標準コントロールを使い、元documentへイベントを偽装しない。
    await pip.bringToFront();
    await pip.locator('video').focus();
    await pip.keyboard.press('Space');
    await expect.poll(() => pip.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
    await pip.keyboard.press('Space');
    await expect.poll(() => pip.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
    // 小窓へ移動した後も、キーボードのフォーカスがなければホバー条件で表示する。
    const returnButton = pip.getByRole('button', { name: '元の画面に戻す' });
    await returnButton.evaluate((element) => (element as HTMLElement).blur());
    await pip.mouse.move(-1, -1);
    await expect(returnButton).toHaveCSS('opacity', '0');
    await pip.locator('#d-comments-pip-player').hover();
    await expect(returnButton).toHaveCSS('opacity', '1');
    await pip.mouse.move(-1, -1);
    await expect(returnButton).toHaveCSS('opacity', '0');

    // 元タブ以外を前面にしても、小窓の映像とコメントが更新される。
    await extensionPage.bringToFront();
    const canvas = pip.locator('#d-comments-canvas-container canvas');
    // GPUの描画バッファではなく、最初のコメントが流れる上半分の表示画像を比較する。
    // 下部の標準コントロールの消灯を除外し、単色映像上のコメントの更新を検査する。
    const commentFrame = async () => {
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error('コメント領域の座標を取得できません');
      return pip.screenshot({ clip: { ...bounds, height: bounds.height / 2 } });
    };
    const before = await commentFrame();
    await expect.poll(async () => !(await commentFrame()).equals(before)).toBe(true);
    const second = await commentFrame();
    await expect.poll(async () => !(await commentFrame()).equals(second)).toBe(true);
    await pip.screenshot({ path: test.info().outputPath('document-pip.png') });

    // PiP中のレンダラー変更でも、移動済みの映像を見つけてcanvasを一つだけ作る。
    await canvas.evaluate((element) => {
      (element as HTMLCanvasElement).dataset.previousRenderer = 'true';
    });
    await extensionPage.evaluate(async (enabled) => {
      const extensionApi = (globalThis as unknown as { chrome: typeof browser }).chrome;
      await extensionApi.storage.local.set({ use_new_renderer: !enabled });
    }, newRenderer);
    await expect(pip.locator('canvas[data-previous-renderer]')).toHaveCount(0);
    await expect(canvas).toHaveCount(1);
    const changed = await commentFrame();
    await expect.poll(async () => !(await commentFrame()).equals(changed)).toBe(true);

    await pip.close();
    await expect(page.locator('#player video')).toHaveCount(1);
    await expect(page.locator('#d-comments-canvas-container canvas')).toHaveCount(1);
    await expect(button).toBeVisible();
    await expect(button).toHaveText('PiP');
    await expect(page.locator('[data-d-comments-pip-placeholder]')).toHaveCount(0);
    await expect(page.locator('video')).toHaveJSProperty('controls', false);
    await checkSiteControls(page, page);

    // 再入場と小窓内の戻すボタンでも復元し、元画面の視聴を続ける。
    await page.locator('#player').hover();
    const secondPopup = extension.context.waitForEvent('page');
    await button.click();
    const secondPip = await secondPopup;
    await expect.poll(() => page.evaluate(() => document.pictureInPictureElement === null)).toBe(true);
    await secondPip.locator('#d-comments-pip-player').hover();
    await secondPip.getByRole('button', { name: '元の画面に戻す' }).click();
    await expect(page.locator('#player video')).toHaveCount(1);
    await expect(page.locator('#d-comments-canvas-container canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
    await page.close();
  });
}

test('スクリプトのクリックを無視し、API拒否時も元画面で再試行できる', async ({ extension, extensionPage }) => {
  await extension.context.route('https://**/*', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/synthetic-video.webm')) return serveSyntheticVideo(route);
    if (url === viewingUrl)
      return route.fulfill({
        contentType: 'text/html',
        body: html,
      });
    if (url.includes('/rest/WS010105?'))
      return route.fulfill({
        json: {
          version: 1,
          data: { title: '合成テスト', workTitle: '合成テスト', partExp: '合成素材' },
        },
      });
    return route.fulfill({ status: 204 });
  });
  await extensionPage.goto(`chrome-extension://${extension.id}/usage.html`);
  await extensionPage.evaluate(async () => {
    const extensionApi = (globalThis as unknown as { chrome: typeof browser }).chrome;
    await extensionApi.storage.local.set({ enable_auto_play: false });
  });
  const page = await extension.context.newPage();
  await page.goto(viewingUrl);
  const button = page.getByRole('button', { name: 'コメント付きPiP', exact: true });
  await expect(button).toBeVisible();
  // ページスクリプトによる操作を無視し、本物の入力だけで起動する。
  const session = await extension.context.newCDPSession(page);
  const contexts: number[] = [];
  session.on('Runtime.executionContextCreated', ({ context }) => {
    contexts.push(context.id);
  });
  await session.send('Runtime.enable');
  await session.send('Runtime.evaluate', {
    expression: 'document.querySelector("#d-comments-pip-controls button").click()',
    userGesture: false,
  });
  await expect(button).toBeVisible();
  await expect(page.locator('#player video')).toHaveCount(1);
  // サイトが先に標準PiPを開いている場合でも、Document PiPの拒否でそれを閉じない。
  await page.locator('video').evaluate((element) => (element as HTMLVideoElement).requestPictureInPicture());
  await expect.poll(() => page.evaluate(() => document.pictureInPictureElement !== null)).toBe(true);
  await page.locator('#player').hover();
  await button.click();
  await expect(page.locator('#d-comments-pip-controls [role="status"]')).toContainText('標準PiPが開いています');
  await expect.poll(() => page.evaluate(() => document.pictureInPictureElement !== null)).toBe(true);
  await page.evaluate(() => document.exitPictureInPicture());
  await expect.poll(() => page.evaluate(() => document.pictureInPictureElement === null)).toBe(true);

  // 拡張の隔離Worldへ一度だけAPI拒否を注入し、巻き戻しと再試行を検証する。
  let extensionContext: number | undefined;
  for (const contextId of contexts) {
    const result = await session.send('Runtime.evaluate', {
      contextId,
      expression: 'globalThis.chrome?.runtime?.id',
      userGesture: false,
    });
    if (result.result.value === extension.id) extensionContext = contextId;
  }
  expect(extensionContext).toBeDefined();
  await session.send('Runtime.evaluate', {
    contextId: extensionContext,
    expression: `(() => {
      const original = documentPictureInPicture.requestWindow.bind(documentPictureInPicture);
      documentPictureInPicture.requestWindow = () => {
        documentPictureInPicture.requestWindow = original;
        return Promise.reject(new DOMException('合成したAPI拒否', 'NotAllowedError'));
      };
    })()`,
  });
  await page.locator('#player').hover();
  await button.click();
  await expect(page.locator('#d-comments-pip-controls [role="status"]')).toContainText('PiPを開けませんでした');
  await expect(page.locator('#player video')).toHaveCount(1);
  await expect(button).toBeEnabled();
  await expect(page.locator('[data-d-comments-pip-placeholder]')).toHaveCount(0);

  // 映像を元documentから外した後の失敗でも、操作部品・映像・表示設定を巻き戻す。
  await page.locator('video').evaluate((element: HTMLVideoElement) => {
    element.style.objectFit = 'fill';
    element.style.width = '91%';
  });
  const originalStyle = await page.locator('video').getAttribute('style');
  await session.send('Runtime.evaluate', {
    contextId: extensionContext,
    expression: `(() => {
      const original = documentPictureInPicture.requestWindow.bind(documentPictureInPicture);
      documentPictureInPicture.requestWindow = async (...args) => {
        documentPictureInPicture.requestWindow = original;
        const popup = await original(...args);
        popup.document.body.append = () => { throw new Error('合成したDOM移動の失敗'); };
        return popup;
      };
    })()`,
  });
  const failedPopupEvent = extension.context.waitForEvent('page');
  await button.click();
  const failedPopup = await failedPopupEvent;
  await expect.poll(() => failedPopup.isClosed()).toBe(true);
  await expect(page.locator('#d-comments-pip-controls [role="status"]')).toContainText('PiPを開けませんでした');
  await expect(page.locator('video')).toHaveAttribute('style', originalStyle ?? '');
  await expect(page.locator('video')).toHaveJSProperty('controls', false);
  await expect(page.locator('[data-d-comments-pip-placeholder]')).toHaveCount(0);
  await checkSiteControls(page, page);

  const popup = extension.context.waitForEvent('page');
  await button.click();
  const pip = await popup;
  await expect.poll(() => page.evaluate(() => document.pictureInPictureElement === null)).toBe(true);
  await expect(pip.locator('#d-comments-pip-player video')).toHaveCount(1);
  await pip.close();
  await expect(page.locator('#player video')).toHaveCount(1);
  await expect(page.locator('video')).toHaveAttribute('style', originalStyle ?? '');
  await expect(page.locator('video')).toHaveJSProperty('controls', false);
  await session.detach();
  await page.close();
});
