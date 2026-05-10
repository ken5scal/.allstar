# 技術方針

updated_at: 2026-05-10

## 実装基盤

- 実装言語は TypeScript、モジュール形式は ESM を前提とする
- 実行環境は Node.js 24 以上を基準にする
- CLI は `commander`、設定ファイルは YAML、状態管理は SQLite を基本とする
- ログは構造化ログを前提とし、失敗通知は Slack adapter で扱う
- Vault 更新や AI 要約は adapter 経由で差し替え可能にする

## アーキテクチャパターン

- CLI は薄く保ち、引数解釈の後は `src/orchestrator.ts` が処理全体を制御する
- ジョブ単位の処理は `src/jobs/` に置き、外部 I/O は `src/adapters/` の interface 越しに扱う
- 設定の読み込み・正規化・検証は実行前にまとめて行い、ジョブ実行中に設定解釈を散らさない
- Vault ノート、Base、AI、通知、X/RSS 取得は provider 切替を前提に mock と real を分離する

## 実行モード

- `validate` は設定と環境の妥当性確認に使う
- `tick` は定期実行の入口であり、スケジュール判定とロックを含む
- `run` は手動実行の入口であり、対象ジョブを明示して挙動確認できる
- 外部依存を伴う処理でも、まず mock で再現できる設計を保つ

## テストの期待値

- 純粋関数や決定的ロジックは unit test で守る
- 設定解釈、adapter 接続、オーケストレーション跨ぎは integration test で守る
- CLI の実行結果、Vault 出力、ジョブ選択、失敗経路のような user-visible behavior は E2E で守る
- E2E では外部サービスではなく、ローカル fixture と一時ディレクトリを優先する

## 文書と実装の関係

- `.kiro/steering/` は project memory、`.kiro/specs/` は human-reviewed な feature contract として読む
- 実装中に必要な判断や差分理由は関連 feature の `.kiro/specs/<feature>/note-from-coding-agents.md` に残し、stable 文書に直接混ぜない
- stable 文書の更新は、人間が承認した変更だけを反映する
