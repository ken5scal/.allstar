# プロジェクト構成

updated_at: 2026-05-10

## 構成方針

実装コード、project memory、feature spec、作業メモを分離する。実装 agent が日々触る場所と、人間が信頼できる正本として守る場所を分けることで、再開性と文書信頼性を両立する。

## ディレクトリパターン

### 実装コード

- `src/`
  - CLI、orchestrator、jobs、adapters を置く主実装領域
- `config/`
  - ローカル実行や fixture で使う設定テンプレートとマスターデータ
- `test/`
  - `unit` / `integration` / `e2e` / `failure-path` / `idempotency` など、リスク単位で検証を分ける

### 保護された文書

- `.kiro/steering/`
  - 常に参照したい project memory を置く
  - 用語、設計原則、運用ルール、長く効く知識を置く
  - 例: project-wide architecture、shared schema、cross-feature constraints
- `.kiro/specs/`
  - feature ごとの `requirements.md`、`design.md`、`tasks.md` などを置く
  - 特に `requirements.md` と `design.md` を挙動の根拠として重視する
  - 例: Obsidian Base record registration のような feature-scoped plan/design

### 作業メモ

- `.kiro/specs/<feature>/note-from-coding-agents.md`
  - 各 feature spec 配下に置く実装 agent の append-only ログ
- `docs/`
  - 一般向け・永続向けの補助ドキュメント
- `docs/ai/`
  - issue 単位、refactor 単位、再開用コンテキスト向けの rough notes
- `docs/ai/plan/`
  - PLAN ファイルの正規置き場

## 命名の傾向

- TypeScript の source file は短い責務名を kebab-case で置く
- job は `collect` / `summarize` / `digest` のように動詞で表す
- adapter は接続先や役割がわかる名前にする
- steering 文書は領域が一目で分かる名前にし、1 ファイル 1 テーマを守る

## 依存関係の原則

- CLI から直接細かい外部 I/O を呼ばない
- job は interface に依存し、adapter 実装詳細に直接依存しない
- stable 文書は作業ログの代わりに使わず、受け入れ済みの知識だけを残す
- 実装で新しいパターンが定着した時だけ steering を更新対象にする
