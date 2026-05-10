# docs/ai

`docs/ai/` は AI 作業用の rough documentation 置き場である。issue 1 つ、refactor 1 まとまり、または compaction / clear 後に再開するためのコンテキストを単位に使う。

## 典型的な内容

- 課題感の説明
- 作業概要やアウトライン
- 動作確認の手順
- 途中経過
- 次に見るべきファイルやコマンド

## 運用ルール

- stable な project memory にする前のメモを置く
- 人間が最終調整する前提の荒い文書でもよい
- 1 作業単位で閉じるように書く
- 新しい PLAN ファイルは `docs/ai/plan/` に置く

## パス方針

- `docs/ai/plan/` を新規 plan の正規パスとする
- `docs/ai/plans/` は legacy path とし、新しいファイルは追加しない
