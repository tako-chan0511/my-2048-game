# GitHub・Vercel公開手順

## 前提

- 独立リポジトリ：`tako-chan0511/my-2048-game`
- 本番ブランチ：`main`。force pushは使用しません。
- Node.js：22系。ローカル／CIの基準は`.nvmrc`の22.23.4、CIはnpm 10.9.9です。package.jsonが許可するNode.js／npmの範囲を守ってください。
- バックエンド、APIキー、環境変数は不要です。ベスト・途中状態は各ブラウザのlocalStorageに保存します。

## 公開前チェック

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
git status -sb
```

`.gitignore`でnode_modules、dist、coverage、.envと派生ファイル、.vercel、ログ、ローカル設定を除外します。認証情報、不要な大容量ファイルをステージしないでください。コミット前に`git diff --cached --stat`と`git diff --cached --check`を確認します。

GitHub ActionsのCIはnpm ci、型チェック、ESLint、全Vitest、本番ビルドを実行します。リポジトリのActions画面で対象コミットの成功を確認してください。

## Vercel

1. 既存プロジェクトの有無を確認します。存在する場合は状態を確認し、重複作成しません。
2. GitHubの`my-2048-game`へ接続します。リポジトリが見つからなければ、Vercel GitHub AppのRepository accessへ追加してください。未接続の状態を接続済みとして扱いません。
3. Framework PresetをVite、Build Commandを`npm run build`、Output Directoryを`dist`、Production Branchを`main`、Node.jsを22.xへ設定します。
4. ProductionデプロイがReadyになり、対象のGitコミットと一致することを確認します。
5. mainへの通常のpush後は自動デプロイの成功を確認します。失敗時はログを確認し、別プロジェクトの設定を変更しないでください。

CLIで認証が必要なら`vercel login`で発行した公式認証URLから、ユーザー自身がブラウザでコードを確認してAllow Accessを押します。期限切れのコードは再使用せず、新しいログインを開始します。

## 本番動作確認

- 初期設定4×4・2048・初期2枚・4が10%・Undo10回・通常モード。
- 3×3〜10×10、目標128〜65536、初期枚数、出現確率0〜100%、Undo上限の適用と入力エラー。
- 通常・時間制限・手数制限、締切一致での入力禁止、時間切れUndo禁止、手数上限からのUndo。
- 矢印キー・Pointer Eventsのスワイプ・方向ボタン、移動・合体・出現、高速入力。
- 達成・ゲームオーバーのポップアップ、継続、背景操作禁止、フォーカス。
- ベスト、自動保存、再読み込み後の復元、Undo後の乱数再現。
- PC・320px・390px、全サイズの配置・数字・横はみ出し、動き軽減設定、コンソールエラー。

本番の保存は本番URLのブラウザに独立します。ローカルホストの保存を自動移行しません。QAでは専用のブラウザコンテキストを使用し、既存ユーザーの記録を変更しないでください。

Safariと物理iOS／Android端末は検証済みになるまで未確認として扱います。公開の成功は、未確認環境での完全な動作保証を意味しません。Game Hubへの登録は単独公開後の別作業です。
