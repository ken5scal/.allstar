# RSS 初回 bootstrap 取得制御計画

最終更新: 2026-05-10

## 1. 背景

複数の RSS source を追加した直後の `collect-rss` は、各 feed の直近 10〜30 件程度をまとめて `captured` として取り込むことがある。  
その後の summarize 側にはすでに backlog 制御を入れたが、初回 collect 自体が大量レコードを生成すると、以後の運用でも backlog 管理が必要になり続ける。

今回の目的は、**初回 collect-rss の時点で取り込む対象を source ごとに絞り込めるようにする**ことである。

## 2. ゴール

以下を実現する。

1. 初回 `collect-rss` のみ、最新 N 件に絞って取り込める。
2. 初回 `collect-rss` のみ、`published_at` が X 日以内の item に絞って取り込める。
3. 上記の bootstrap 制御を source ごとに個別設定できる。
4. bootstrap で除外した backlog が次回以降に再流入しない。

## 3. 非ゴール

今回の計画では以下は対象外とする。

- summarize 側のコスト見積り機能
- AI provider 料金の自動推定
- RSS source 全般の通常時レート制御
- feed 全体の cursor モデル再設計

## 4. 現状

### 4.1 collect の現挙動

- `collectRssSource()` は feed 全 item を取得する。
- `processNewItems()` は `seen_items` を見て未処理 item をそのまま Vault へ保存する。
- 保存レコードは `status: captured` で作成される。
- 最後に `checkpoints` へ `polled_at` / `item_count` を保存する。

### 4.2 現状の問題

初回 collect で item を「選別せずに」全部見ているため、設定追加直後の feed backlog がそのまま Vault に流れ込む。  
また、checkpoint は feed item 個別の既読を表していないため、**初回 bootstrap で古い item を単に“未選択”にするだけでは、次回以降に再び collect 対象として現れる**。

このため、初回 bootstrap 制御では「取り込む item」だけでなく「意図的に捨てる backlog」をどう永続化するかを決める必要がある。

## 5. 提案する設定仕様

source ごとの `bootstrap` ブロックを `sources.rss[]` 配下に追加する。

```yaml
sources:
  rss:
    - id: "hn"
      enabled: true
      schedule: "*/30 * * * *"
      url: "https://news.ycombinator.com/rss"
      bootstrap:
        max_initial_items: 10
        published_within_days: 7
```

### 5.1 フィールド案

- `sources.rss[].bootstrap.max_initial_items`
  - positive integer
  - 初回 collect の取り込み上限件数
- `sources.rss[].bootstrap.published_within_days`
  - positive integer
  - 初回 collect で「現在時刻から X 日以内」の item のみ対象にする

### 5.2 設定の意味

- `bootstrap` ブロックがない source は従来どおり全件候補とする。
- `max_initial_items` のみ指定した場合は「最新 N 件だけ取り込む」。
- `published_within_days` のみ指定した場合は「X 日以内の item だけ取り込む」。
- 両方指定した場合は「X 日以内で、かつ最新 N 件」にする。

## 6. bootstrap 判定ルール

### 6.1 初回判定

v1 では以下を bootstrap 判定とする。

- `state.getCheckpoint("rss:<source_id>") === null`

理由:

- collect 成功時には checkpoint が必ず保存される。
- fetch / hydrate / state 書き込み失敗で初回 run が完了しなかった場合、checkpoint は残らないため bootstrap を再試行できる。
- 既存の `seen_items` まで見て「過去に一度でも source が動いたか」を厳密に判定するより、現状の state model との整合が良い。

### 6.2 bootstrap 適用タイミング

- bootstrap 判定は **source 単位** で行う。
- 同じ run の中でも、source A は bootstrap 対象、source B は通常 collect、という混在を許容する。

## 7. 初回 bootstrap 選定アルゴリズム

初回 collect で bootstrap が有効な source には、通常の `processNewItems()` の前に以下の選定を入れる。

### 7.1 前処理

1. feed item を通常どおり取得する。
2. item ごとに「比較用 timestamp」を決める。
   - `publishedAt` が妥当ならその値を使う
   - `publishedAt` が無効または欠落なら feed の元順序を fallback に使う

### 7.2 published 日数フィルタ

`published_within_days` が設定されている場合:

1. `now - X * 24h` を閾値にする
2. `publishedAt` が有効で、かつ閾値以降の item だけを残す
3. `publishedAt` が無い item は **除外** する

v1 で undated item を除外する理由:

- 「X 日以内」という設定の意味を壊さない
- コスト抑制を優先する
- missing timestamp を含めると source ごとの挙動が読みにくくなる

### 7.3 latest N フィルタ

`max_initial_items` が設定されている場合:

1. timestamp 降順で並べる
2. 同時刻または timestamp 無しの item は feed 元順序で安定化する
3. 先頭 N 件だけを採用する

### 7.4 選定後の扱い

- 採用された item は通常どおり Vault へ保存し、`seen_items` に mark する
- 不採用 item は **Vault へは保存せず、`seen_items` には mark する**

ここが重要である。  
単に「初回は保存しない」だけだと、次回 collect で同じ backlog item が再び未処理扱いになる。  
そのため、bootstrap で意図的に落とした item は **“見送った backlog” として既読化する**。

## 8. checkpoint と既読化の扱い

### 8.1 checkpoint

bootstrap 適用後も collect が正常終了したら checkpoint は保存する。  
これは bootstrap 採用件数が 0 件でも同じとする。

### 8.2 seen_items

v1 では bootstrap 除外 item も `seen_items` に登録する。  
これにより、以後その item は再流入しない。

### 8.3 この設計のトレードオフ

- 利点:
  - 実装が小さい
  - 既存 state schema を流用できる
  - 初回 backlog を確実に捨てられる
- 欠点:
  - bootstrap で除外した item は後から自動復活しない
  - 同一 `item_key` の記事が後日本文更新されても、v1 では再取り込みしない

この欠点は「初回 backlog を安全に捨てる」という今回の主目的に対して許容範囲とみなす。

## 9. 想定ログ / 可観測性

最低限、source ごとに以下の件数を出す。

- `fetched_total`
- `bootstrap_selected_total`
- `bootstrap_filtered_by_age_total`
- `bootstrap_filtered_by_limit_total`
- `processed`
- `skipped`

イベント案:

- `collect_rss_bootstrap_start`
- `collect_rss_bootstrap_applied`
- `collect_rss_bootstrap_done`

manual 実行サマリにも、必要なら後続で以下を追加する余地がある。

- `bootstrap_selected`
- `bootstrap_filtered`

ただし v1 の最小実装では、まず構造化ログを優先し、manual summary の拡張は optional とする。

## 10. 実装方針

### 10.1 変更対象

- `src/types.ts`
  - RSS source 用 bootstrap config 型を追加
- `src/config.ts`
  - YAML parse / validation を追加
- `src/jobs/collect.ts`
  - bootstrap 判定
  - bootstrap item 選定
  - bootstrap 除外 item の既読化
  - 集計ログ追加
- `config/config.yaml.template`
  - 設定例の追加
- 必要に応じて `README.md` / `TEST_PLAN.md`
  - bootstrap 設定の説明を追加

### 10.2 実装ステップ

1. `bootstrap` config を型・parser に追加する
2. RSS bootstrap selector helper を `collect.ts` に追加する
3. 初回 collect 判定 (`checkpoint == null`) を追加する
4. bootstrap 除外 item を `seen_items` へ mark する経路を追加する
5. source ごとのログ / 件数を追加する
6. docs / template を更新する

## 11. テスト計画

### 11.1 Unit

- config parse:
  - `bootstrap.max_initial_items` を正しく読む
  - `bootstrap.published_within_days` を正しく読む
  - 0 / 負数 / 非整数を reject する
- selector:
  - latest N が timestamp 降順で選ばれる
  - `published_within_days` で古い item が除外される
  - undated item が age filter 時に除外される
  - 両条件指定時に intersection になる

### 11.2 Integration

- 初回 collect で latest N だけ Vault に保存される
- 初回 collect で age filter に入らない item が保存されない
- 初回 collect で不採用 item が次回以降に再流入しない
- 2 回目 collect では bootstrap が走らず、真に新しい item だけが増える

### 11.3 E2E

collect の command-level behavior が変わるため E2E も必要。

- `run --targets collect-rss` で bootstrap 制御が最終 artifact に反映される
- Vault 作成件数と state (`checkpoints`, `seen_items`, `job_runs`) が期待どおりになる

## 12. オープン事項

### 12.1 age filter の基準時刻

v1 は `now - X * 24h` の rolling window とする。  
「ローカル日付ベースで当日含む X 日」にしたい場合は別仕様になるため、今回は採らない。

### 12.2 undated item の扱い

age filter 時は除外とする。  
将来、source ごとに `include_undated` が必要なら別途拡張する。

### 12.3 manual summary への件数表示

v1 は logs 優先。  
手動運用で見え方が足りない場合に `collect-rss` summary 拡張を次段で追加する。

## 13. 推奨結論

最小で安全な実装として、以下を採用する。

1. `sources.rss[].bootstrap.max_initial_items`
2. `sources.rss[].bootstrap.published_within_days`
3. 初回判定は `checkpoint == null`
4. bootstrap 除外 item は `seen_items` に mark する
5. 正常終了時は checkpoint を保存する

この方針なら、初回 RSS backlog を source ごとに確実に切り落としつつ、既存の state model と collect pipeline に最小差分で組み込める。
