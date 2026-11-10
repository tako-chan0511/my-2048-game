# STEP 1 実装・検証結果

確認日：2026-11-10（JST）。対象：`~/projects/my-2048-game`のみ。

## 実装

4×4、初期2枚、目標2048、通常モード。四方向のスライド、1移動1合体、bigintスコア、有効移動時のみ1枚出現、90%が2・10%が4、手数、目標到達、ゲームオーバーを実装しました。目標後も継続できます。

コアはVue非依存の純粋なTypeScriptです。盤面・スコア・手数・乱数・次タイルIDをPositionへ集約し、同じPositionを復元して同じ移動を行うと全結果が再現します。無効移動では元の状態オブジェクトを返し、乱数を消費しません。将来のUndo設定の既定値は10です。

## 検証

| 項目 | 結果 |
|---|---|
| 実行環境 | Node.js 22.23.4、npm 10.9.9でクリーンインストール確認 |
| `npm ci` | 成功 |
| `npm run test` | **201件成功 / 5テストファイル** |
| `npm run typecheck` | strict・noUncheckedIndexedAccessを含め成功 |
| `npm run lint` | 成功 |
| `npm run build` | 成功（Vite 7.3.8） |
| 依存関係の監査 | 0 vulnerabilities |
| 開発サーバー | `npm run dev`の起動と実ブラウザ操作に成功 |
| ビルド済み画面 | `npm run preview`で起動・合体・加点・手数を確認 |

要求された5つの合体例、全方向、IDの一意性、BigIntの精度、固定シード、乱数状態の復元・消費境界、無効移動、ゲームオーバー、2048達成、盤面合計保存をテストしています。独立したスタック方式との比較は固定64盤面×4方向、長い対局の再現は6シード×160操作です。UI・状態管理もVue Test Utilsで検証しました。

## ブラウザ確認

既存の検証用Playwrightを利用したローカルChromiumの確認です。スマートフォンはブラウザのタッチ対応エミュレーションで、実機確認ではありません。

| 幅 | 盤面幅 | 確認結果 |
|---|---:|---|
| PC 1366px | 420px | 初期2枚、四方向、合体・加点・手数、無効移動、新しいゲーム |
| スマートフォン 390px | 324px | タッチによる方向ボタン操作、同じゲーム更新、横はみ出しなし |
| スマートフォン 320px | 254px | タッチによる方向ボタン操作、同じゲーム更新、横はみ出しなし |

全操作ボタンは48px以上です。各画面でページ例外・console errorは0件でした。PCでは固定シード0を242回操作し、有効241手・スコア3020でゲームオーバーになることをコアと照合しました。全方向ボタンが無効になり、新しいゲームで再開できました。

## 作成ファイル一覧

すべて新規ファイルです。生成物`node_modules/`、`dist/`は一覧に含めず、Git管理対象外です。

- `.github/workflows/ci.yml`
- `.gitignore`
- `.nvmrc`
- `README.md`
- `docs/engine.md`
- `docs/step1-report.md`
- `eslint.config.mjs`
- `index.html`
- `package-lock.json`
- `package.json`
- `public/icon.svg`
- `src/App.vue`
- `src/components/GameBoard.vue`
- `src/composables/use2048Game.ts`
- `src/core/board.ts`
- `src/core/game.ts`
- `src/core/index.ts`
- `src/core/random.ts`
- `src/core/slide.ts`
- `src/core/spawn.ts`
- `src/core/types.ts`
- `src/core/validation.ts`
- `src/main.ts`
- `src/style.css`
- `src/vite-env.d.ts`
- `tests/fixtures.ts`
- `tests/game.spec.ts`
- `tests/random.spec.ts`
- `tests/slide.spec.ts`
- `tests/spawn.spec.ts`
- `tests/ui.spec.ts`
- `tsconfig.json`
- `vercel.json`
- `vite.config.ts`

## 範囲と保護確認

Undo機能、保存・復元、ベスト記録、モード制限、設定画面、キーボード、スワイプ、本格的なアニメーションは未実装です。GitHub用CIとVercel用設定を準備しましたが、リポジトリ作成・コミット・push・外部デプロイ・Game Hub登録は行っていません。GitHub Actionsのリモート実行は未実施です。

既存calcudoku 84ファイル、maze-generator 28ファイル、toppage 61ファイルについて、追跡ファイルと未追跡ファイルの一覧・SHA-256を作業前後で比較し、追加・変更がないことを確認しました。toppageの既存`.gitignore`変更と未追跡`.puml`2件も保持しています。
