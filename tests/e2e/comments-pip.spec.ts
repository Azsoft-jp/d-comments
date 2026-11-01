// 認証や実番組を使わず、合成映像と共有スレッドで拡張の表示・PiP往復を検証する。
import { expect } from '@playwright/test';
import type { CommentVideoData } from '../../src/types/comments';
import { test } from './fixtures';

const viewingUrl = 'https://animestore.docomo.ne.jp/animestore/sc_d_pc?partId=00000001';
const html = `<!doctype html><html lang="ja"><head><title>合成テスト</title>
<meta name="Description" content="許諾不要の合成素材">
<style>body { margin: 0; } #host { width: 960px; height: 540px; }
#player { position: relative; width: 100%; height: 100%; min-width: 0; flex: 1; }
video { width: 100%; height: 100%; object-fit: contain; }</style></head>
<body><div id="host"><div id="player"><video autoplay muted playsinline></video></div></div>
<script>
// 放送素材の代わりに、自作の色面を24fpsで映像化する。
const source = document.createElement('canvas'); source.width = 640; source.height = 360;
const context = source.getContext('2d');
setInterval(() => { context.fillStyle = '#184060';
context.fillRect(0, 0, 640, 360); }, 1000 / 24);
document.querySelector('video').srcObject = source.captureStream(24);
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

for (const newRenderer of [false, true]) {
  test(`共有コメントは1件になり、PiPへ往復できる (${newRenderer ? 'Pixi' : 'Niconi'})`, async ({
    extension,
    extensionPage,
  }) => {
    const unexpectedRequests: string[] = [];
    await extension.context.route('https://**/*', async (route) => {
      const url = route.request().url();
      if (url === viewingUrl) return route.fulfill({ contentType: 'text/html', body: html });
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
    await expect
      .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0);
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
    const popup = extension.context.waitForEvent('page');
    await button.click();
    const pip = await popup;
    await expect(pip.locator('#player video')).toHaveCount(1);
    await expect(pip.locator('#d-comments-canvas-container canvas')).toHaveCount(1);
    await expect(page.locator('video')).toHaveCount(0);
    await expect(pip.getByRole('button', { name: '元の画面に戻す' })).toBeVisible();
    await expect.poll(() => pip.locator('video').evaluate((video: HTMLVideoElement) => !video.paused)).toBe(true);

    // 元タブ以外を前面にしても、小窓の映像とコメントが更新される。
    await extensionPage.bringToFront();
    const canvas = pip.locator('#d-comments-canvas-container canvas');
    // GPUの描画バッファはフレーム後に消去されるため、表示された画像を比較する。
    // 合成映像は常に同じ色なので、画像が変化するのはコメントが移動した場合だけ。
    const before = await canvas.screenshot();
    await expect.poll(async () => !(await canvas.screenshot()).equals(before)).toBe(true);
    const second = await canvas.screenshot();
    await expect.poll(async () => !(await canvas.screenshot()).equals(second)).toBe(true);
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
    const changed = await canvas.screenshot();
    await expect.poll(async () => !(await canvas.screenshot()).equals(changed)).toBe(true);

    await pip.close();
    await expect(page.locator('#player video')).toHaveCount(1);
    await expect(page.locator('#d-comments-canvas-container canvas')).toHaveCount(1);
    await expect(button).toBeVisible();
    await expect(page.locator('[data-d-comments-pip-placeholder]')).toHaveCount(0);

    // 再入場と小窓内の戻すボタンでも復元し、元画面の視聴を続ける。
    const secondPopup = extension.context.waitForEvent('page');
    await button.click();
    const secondPip = await secondPopup;
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
  await button.click();
  await expect(page.locator('#d-comments-pip-controls [role="status"]')).toContainText('PiPを開けませんでした');
  await expect(page.locator('#player video')).toHaveCount(1);
  await expect(button).toBeEnabled();
  await expect(page.locator('[data-d-comments-pip-placeholder]')).toHaveCount(0);
  const popup = extension.context.waitForEvent('page');
  await button.click();
  const pip = await popup;
  await expect(pip.locator('#player video')).toHaveCount(1);
  await pip.close();
  await expect(page.locator('#player video')).toHaveCount(1);
  await session.detach();
  await page.close();
});
