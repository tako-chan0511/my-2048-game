# 移動表示と10手周期の回帰確認

編集マス用の`.board .cell { position: relative }`が、同じcellクラスを使う移動用タイルにも適用され、absoluteを上書きしていました。移動・合体中だけタイルが盤面の外へずれ、終了時に戻る原因です。編集用の指定を`.board-row > .cell`へ限定しました。

Vitestの画面テストに加え、実ブラウザーの各描画フレームでcomputed positionとタイルの矩形を測定します。PC・320px・390pxと3×3〜10×10の全8サイズを確認し、スライド／出現中もabsoluteで盤面内に収まることを検証します。10×10では新規ゲームから20回の有効移動を実行し、初期値の10手周期で1回・2回の権利を取得し、演出終了後に実際の変更ボタンが使えることも検証します。

ブラウザー検証は任意のPlaywright環境で実行できます。アプリの依存関係やCIには追加しません。

```
npm run build
npm run preview -- --host 127.0.0.1 --port 4175
# 別ターミナル。Playwrightが解決可能な環境ならPLAYWRIGHT_MODULEは省略可。
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/motion-regression.mjs
```

`TEST_URL`で対象URLを指定できます。公開URLがSecurity Checkpointなどで応答しない場合は停止し、回避しません。

スペシャルタイムの獲得は有効移動だけを数えます。設定変更は「この設定で新しいゲーム」で適用し、通常の「新しいゲーム」は適用済み設定を維持します。未適用の変更は設定パネルに表示し、獲得後にボタンで変更権を使うことも盤面近くへ案内します。
