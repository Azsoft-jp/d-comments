# コメント重複とDocument PiPの検証

## 修正内容

複数の動画が同じコメントスレッドを返す場合、従来の表示用データは両方を連結していた。
表示用データをスレッドID・forkごとに統合し、その中の投稿IDが同じコメントを一件にまとめる。
64bitの投稿IDは文字列のまま扱う。同文・同時刻でも別IDの投稿や別スレッドの投稿は残す。
選択中の動画は個別に保持するので、片方の動画を外しても残った動画のコメントを表示できる。

映像右上のアイコン付き「PiP」ボタンは[Document Picture-in-Picture API](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)を使う。
再生中のvideoとコメントcanvasを含む領域を同じ小窓に移し、映像にコメントを重ねる。
映像のキャプチャ、再取得、再エンコードはしない。
描画には映像の移動先WindowのrequestAnimationFrameを使う。
小窓の閉じる操作と「戻す」ボタンで、移動前の位置とスタイルへ戻す。
ボタンはキーボードでも操作でき、フォーカス枠と操作名「コメント付きPiP」「元の画面に戻す」を持つ。
ブラウザがAPIに対応しない場合はボタンを無効にし、APIが拒否された場合は理由の確認と再試行を促す。

レンダラーの設定変更は順番に処理し、非同期初期化の重複を防ぐ。
NiconiCommentsの公開されたinternal.renderer.createRendererを使い、別Windowのcanvasに対するinstanceof判定を避ける。
このAPIへの依存は、NiconiCommentsを更新するときに再検証する。

## ローカルで試す

```sh
pnpm install --frozen-lockfile
pnpm build:chrome
```

Chromeの拡張機能管理画面でデベロッパーモードを有効にし、「パッケージ化されていない拡張機能を読み込む」から
このリポジトリの`dist/chrome-mv3`を選択する。
ストア版と修正版が同じページで動くと両方が描画するため、試験中はストア版を無効にして視聴ページを再読み込みする。
既存の認証情報やストア版の設定は、修正版へ自動移行しない。

視聴ページでコメントを取得し、映像右上の「PiP」を押す。
ブラウザ標準の映像専用PiPボタンは、この拡張のDocument PiPを起動しない。
別タブへ移った後のコメントの流れ、小窓の拡大縮小、閉じる操作、再入場を確認する。

## 自動検査

```sh
pnpm exec vitest run --project unit
pnpm compile
pnpm lint
pnpm build:chrome
pnpm exec playwright test --workers=1
HEADED=1 pnpm exec playwright test tests/e2e/comments-pip.spec.ts --workers=1
```

新しいE2Eは一時プロファイルを使う。dアニメストアへの通信はローカルで模擬応答し、
合成した単色映像とコメントだけで、スレッドの統合、両レンダラー、Document PiPの往復、
描画の継続、PiP内でのレンダラー切替、ページスクリプトのクリックの無視、API拒否からの再試行を検証する。
API拒否は拡張の隔離Worldへ一度だけ注入する。ブラウザ標準の拒否条件を再現した検査とは区別する。
GPUの描画バッファはフレーム後に消去される場合があるため、描画の継続は実画面の画像で比較する。
背景映像は単色のままなので、コメント以外の映像変化を成功条件へ混ぜない。

2026-11-01のローカル検証結果は次のとおり。

| 検査 | 結果 |
| --- | --- |
| 単体テスト | 114件成功 |
| TypeScript・Lint・差分の空白検査 | 成功 |
| Chrome MV3・Firefox MV2のビルド | 成功 |
| ChromiumのE2E全体 | 7件成功、実サイト向け4件スキップ |
| 画面を表示したChromiumでの追加E2E | 3件成功 |

実サイトのログイン、DRM付き映像、サイト固有の操作部品、連続再生、全画面との切替、長時間利用、
他OSとFirefoxの実行時挙動は未検証。既存の実サイト統合テストは、認証済みプロファイルと対象URLを渡さない限りスキップする。
共有IDではない別投稿の同文コメントと、異なる拡張機能による二重描画は、この重複除去の対象外である。
