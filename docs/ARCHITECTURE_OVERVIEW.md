# 個人向け情報収集・要約パイプライン: 要件と全体構成

最終更新: 2026-05-05

## 1. 目的

個人向けに、以下の情報源を継続収集し、Obsidian Vault に保存したうえで AI 要約を追記し、定期的なサマリ参照を可能にする。

- RSS
- X (Search / Lists / Bookmarks)

補足:
- Web 記事・YouTube は手動取得 (例: Obsidian Web Clipper) を許容する。
- 本ドキュメントは「全体構成と要件の合意」を目的とし、詳細設計は含めない。

## 2. スコープ

### 2.1 今回のスコープ (In Scope)

- Obsidian Markdown-first の保存方針
- 1 ソース = 1 レコード方針
- ローカル実行を前提とした定期処理
- 設定ファイルによる複数スケジュール管理
- Cursor SDK を使ったエージェント実行
- Obsidian Skills を使った Vault 更新
- X 公式 TypeScript SDK の利用方針
- エラー時の Slack 通知

### 2.2 非スコープ (Out of Scope / 後続)

- frontmatter スキーマ詳細
- トピック分類ルール詳細
- 運用ルール詳細 (例: ブックマーク判断基準)
- モデル比較・評価詳細

## 3. 合意済み要件

1. 正本は **Obsidian Markdown-first** とする。  
2. レコード粒度は **1 ソース = 1 レコード** とする。  
3. 自動収集対象は **RSS + X** とする。  
4. X の取得対象は **Search / Lists / Bookmarks** とする。  
5. ノイズ最小化の運用優先順位は **Bookmarks > Lists > Search** とする。  
6. 実装基盤は **TypeScript + Cursor SDK** とする。  
7. Vault 更新は **Obsidian Skills を利用したエージェント実行**で行う。  
8. X 読み取りは **X 公式 TypeScript SDK** を第一候補とする。  
9. X API 未契約のため、初期実装は **X モック provider** を標準にする。  
10. AI モデル未確定のため、初期実装は **AI モック provider** を標準にする。  
11. ローカルスケジューラは **macOS の標準機構 (launchd)** を想定する。  
12. スケジュールは設定ファイルで複数定義できる構成にする。  
13. 失敗時は **都度 Slack へエラー通知** する。  
14. 通知は定期ジョブではなく、エラーハンドリングモジュールとして扱う。  
15. 実行環境は **Node.js 24 以上** とする（`package.json` の `engines` および CI の Node マトリクスで固定）。

## 4. 全体構成 (シンプル版)

個人開発の複雑さを抑えるため、コンポーネントは最小に保つ。

1. **Runner**
   - 単一エントリーポイント (`tick`)。
   - 設定を読み、実行すべき処理を順に呼ぶ。
   - Cursor SDK 経由でエージェント呼び出しをオーケストレーションする。

2. **Source**
   - RSS / X (Search, Lists, Bookmarks) 取得。
   - 増分取得と重複抑制のための状態参照を行う。
   - X は official SDK provider と mock provider の切替を前提とする。

3. **Vault**
   - Obsidian Vault への Markdown 保存/更新。
   - 1 ソース = 1 レコードで反映。
   - 更新処理は Obsidian Skills を使うエージェント実行を前提とする。

4. **AI**
   - 取得済みレコードへの要約追記。
   - 必要に応じて定期サマリ生成に利用。
   - モデル未確定のため、初期は mock provider を許容する。

5. **Alert (横断)**
   - 例外/失敗時のみ Slack 通知。

## 5. 高レベルデータフロー

1. `launchd` が定期的に `tick` を起動する。  
2. Runner (TypeScript) が設定を読み、対象ソースの収集を実行する。  
3. 取得データを 1 レコード単位で保存し、Vault 更新は Cursor SDK + Obsidian Skills で反映する。  
4. 新規/更新レコードに対して AI 要約を追記する (初期は mock で代替可能)。  
5. 失敗があれば Alert が Slack 通知する。  

## 6. RSS と「受信サーバー」について

RSS は push 受信ではなく、基本的に pull (定期取得) で扱う。  
したがって、現時点のスコープでは常時起動の受信サーバーは不要。

## 7. 実行形態の方針

- 当面はローカル (macOS + launchd) で運用する。
- 実行を単一コマンド中心に設計し、将来 GitHub Actions へ移しやすくする。
- 構成は「小さく開始し、必要時のみ分割」する。
- 外部依存 (X/AI/Slack) は mock provider から開始し、後で real provider を有効化する。

## 8. 今後の作業 (次フェーズ)

1. TypeScript 実装向けの詳細設計更新
   - provider interface と mock/real 切替仕様
   - Cursor SDK + Obsidian Skills 呼び出し仕様
2. 実装用 CLI 仕様の最小化
   - 単一コマンド運用を前提
3. テスト計画 (TEST_PLAN.md) の確定
   - checkpoint 単位テスト
   - idempotency / failure-path / smoke
4. 検証
   - ローカル定期運用での挙動確認

## 9. 補足メモ

- 本段階はアーキテクチャ合意フェーズであり、実装詳細は意図的に保留している。
- ノイズ対策は「高度な自動分類」より先に「入力源選定と運用設計」で抑制する。
- 実装言語は Go 案から TypeScript + Cursor SDK 方針へ更新した。

## 10. GitHub での管理方針 (個人・複数プロジェクト前提)

ドキュメント本体と進捗管理は、役割を分けて運用する。

1. **リポジトリ管理 (正本)**
   - `ARCHITECTURE_OVERVIEW.md` は対象プロジェクトのリポジトリで管理する。
   - 設計変更は PR ベースで更新し、履歴と差分を残す。
   - 将来的には `docs/architecture/` へ整理してもよい。

2. **GitHub Projects 管理 (進捗)**
   - Projects はタスク管理に使う。
   - 例: Todo / Doing / Done、優先度、次アクションを管理する。
   - ドキュメント本文は Projects に置かず、リポジトリ内ドキュメントへのリンクで参照する。

3. **複数プロジェクト横断の整理**
   - 個人で複数案件を回す場合、1 つの横断 Project を用意して各リポジトリの Issue/PR を集約する。
   - アーキテクチャ文書の正本は各リポジトリに保持し、Project 側はインデックス/進捗ビューとして使う。
