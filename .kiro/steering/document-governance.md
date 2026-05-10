# 文書管理ルール

updated_at: 2026-05-10

## 目的

`.kiro/` 配下の文書を、人間が見ても信頼できる project memory として維持する。stable な知識、feature ごとの承認済み要件・設計、作業中の rough notes を混ぜないことを最優先にする。

## 文書の役割分担

### 1. `.kiro/steering/`

- AI が常に参照すべき project-wide の知識を置く
- 用語、設計原則、運用ルール、長く効く判断基準を置く
- プロジェクト全体に効く architecture overview、shared schema、cross-feature design constraints を置く
- `AGENTS.md` や `CLAUDE.md` と同じく、着手前に読む前提の置き場として扱う
- 一時的な TODO、未承認の仮説、作業途中のメモは置かない

### 2. `.kiro/specs/`

- feature ごとの要件、設計、タスク、補助メモを置く
- `requirements.md` と `design.md` を最重要の根拠として扱う
- `tasks.md` は execution plan であり、要件・設計より下位に置く
- 1 つの feature や scope に閉じた計画書、実装方針、migration 手順は steering ではなく specs に置く
- 実装が進んでも、承認前の思いつきで上書きしない

### 3. `.kiro/specs/<feature>/note-from-coding-agents.md`

- 各 feature spec 配下に置く、実装 agent の append-only 作業ログ
- ユーザー指示、変更理由、既存実装から分かった制約、spec と code の差分、再開時に必要な検証メモを残す
- stable 文書に直接書くには早いが、失うと困る情報を退避する場所として使う

### 4. `docs/`

- 一般的な補助ドキュメント置き場
- 運用ガイド、観測メモ、補足説明など、必ずしも AI の mandatory context ではない文書を置く

### 5. `docs/ai/`

- rough な AI working docs を置く
- issue 1 つ、refactor 1 まとまり、再開用のコンテキストなど、作業単位で管理する
- 内容には課題感、作業概要、検証手順、途中経過、次の一手を含めてよい

### 6. `docs/ai/plan/`

- PLAN ファイル専用の出力場所
- 新規 plan はこの singular path を正とする
- 既存の `docs/ai/plans/` は legacy path とし、新しいファイルは置かない

## 保護ルール

- `.kiro/steering/**` と `.kiro/specs/**` は protected docs として扱う
- 実装担当 agent は protected docs を常に読んでよい
- 実装担当 agent は、人間の明示承認なしに protected docs を新規作成・編集・リネーム・削除してはいけない
- 承認は「このスレッドで、その文書変更をしてよい」と分かる形で与えられている必要がある
- 例外は active feature の `.kiro/specs/<feature>/note-from-coding-agents.md` の追記だけである

## 作業ログの記録ルール

実装 agent は、次のような情報が出たら active feature の `.kiro/specs/<feature>/note-from-coding-agents.md` に追記する。

- ユーザーが設計意図や変更経緯を説明したとき
- spec / design と既存実装のズレを見つけたとき
- 実装方針のトレードオフを選んだとき
- 検証手順や再現条件を調べ直したとき
- compaction / clear 後に再開できる形で状況を残したいとき

各エントリには最低限、以下を含める。

- 記録日時
- agent 名
- session / thread / branch / PR の識別子のうち分かるもの
- 対象タスクまたはスコープ
- 関連する code / spec / steering / docs のパス
- 決定事項、発見、未解決事項
- review 後に requirements / design / steering へ反映が必要かどうか

ログは append-only とし、過去エントリを書き換えて要約し直さない。

feature spec がまだない作業では、`.kiro/` 直下にログを置かず、`docs/ai/` に再開用メモを残す。

## 実装完了後の同期ルール

人間のコードレビューが終わって実装内容が受け入れられたら、次を確認する。

1. 関連 feature の `.kiro/specs/<feature>/note-from-coding-agents.md`
2. 受け入れ済みの code diff
3. 関連する `requirements.md`
4. 関連する `design.md`
5. 必要なら project-wide な steering

この確認で要件・設計・運用知識が stale になっているなら、更新候補を洗い出す。protected docs を実際に更新するのは、人間がその更新を承認した後に限る。

## 信頼性の基準

- stable 文書には、受け入れ済みの事実・判断・規約だけを残す
- 仮説や途中メモは `docs/ai/` または関連 feature の `note-from-coding-agents.md` に留める
- 日付を残し、古くなった記述は承認済み変更に合わせて更新する
- 長期に参照しない一時メモを steering に昇格させない
- 新しい実装が既存パターンに従うだけなら、steering はむやみに増やさない
