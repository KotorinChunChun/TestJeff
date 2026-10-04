# 開発手順

Python 3.12、Git、uv、NVIDIAドライバーを使用する。専用 .venv 以外にパッケージをインストールしない。
`pwsh -NoProfile -File dev/scripts/setup.ps1` でセットアップする。
上流は vendor/jeff submodule、モデルリビジョンは models.json に固定する。
`pwsh -NoProfile -File dev/scripts/jeff.ps1 verify --all` で実HTTP試験を実行する。詳細はREADMEを参照する。
本件のJSON結果はdev/testing/outputへ出力し、要約だけをtesting/RESULTS.mdへ記録する。

公式の軽量試験は、専用環境へ `uv pip install --python .venv/Scripts/python.exe pytest==9.1.1` を追加してから、`.venv/Scripts/python.exe -m pytest vendor/jeff/tests/test_server_limits.py vendor/jeff/tests/test_device.py -q` で実行する。
WindowsではCUDA 13.0版torch/torchvisionを使う。CUDAインデックスから他の依存を入れ直すとnumpyの版が上流指定とずれるため、setup.ps1はCUDAの2パッケージだけを--no-depsで導入する。
実測時の依存一覧はdev/testing/environment.txtを参照する。上流pyproject.tomlは推論に必要な直接依存を固定している。
GPU試験ではHTTPクライアントとモデルサーバーを別プロセスにする。Windowsのvenvは子Pythonを生成するため、検証終了は自分が起動したPIDのツリーを終了し、ポート解放を待ってから次のモデルを読み込む。
Jevの実サービスへの接続・完全互換性の比較試験は行っていない。検証対象はJeffが提供するJev形式の `/v1/systemone` と公式スキーマである。

トップ `/` はsrc/index.htmlによるメニュー専用画面で、接続スクリプトを注入しない。日本語サンプル画面は `/samples`（`/samples/` も可）のsrc/playground.html。公式MIT版を元に本件用として管理し、上流submoduleは変更しない。`GET /testjeff/examples` でtests/requests.jsonを読み、すべてのプリセットを生成する。`node tests/playground.test.cjs` は画面スクリプトをDOM代替上で実行し、全サンプルの選択・送信内容・ordersの一致を確認する（実ブラウザーの描画試験とは区別する）。

名詞判定はsrc/nouns.html、nouns.js、nouns-core.js。GET /nounsとGET /testjeff/nounsを追加し、既存の/v1/systemoneへ候補ごとにnoulを送信する。辞書はsrc/data/nouns-source.txtとnouns.jsonの一致をテストで保つ。名詞を追加・変更するときは両方を更新する。

Node.jsはブラウザーテスト専用。`npm ci`、`npm test` で辞書と抽選、日本語画面の送信内容を確認できる。`node tests/nouns-browser.cjs` は既存Microsoft Edgeをヘッドレスで起動し、1クリックでの抽選・10件評価・逐次通信・空入力・中止・認証エラーを確認する。追加ブラウザーのダウンロードは不要。Playwrightの依存は本件内node_modulesへ分離する。

実モデルでのブラウザーテストは、サーバー起動後にpwshで `$env:LIVE_URL='http://127.0.0.1:8765'; node tests/nouns-browser.cjs` を実行する。現在の検証件数と切り替え順は次段落を参照する。JSONとパソコン幅・スマートフォン幅のスクリーンショットはdev/testing/outputへ保存する。

v0.3.0以降のブラウザーテストは計50件（0.8Bの手動10件＋ランダム20件、2B/Gemma各10件）。起動モデルを0.8Bにして実行し、最後に0.8Bへ戻す。モデル別の加算・平均値・再読込・リセット・中止/失敗除外も確認する。

`POST /testjeff/model` は `{"model":"qwen-2b"}` 等を受け取り、推論と同じservice.lockで排他する。旧モデルを解放・GC・CUDAキャッシュ解放後に次モデルをロードする。上流lifespanはモデルをローカル変数に保持するため、本件のlifespanはserviceだけにモデルを所有させる。同時切り替えは409、不正モデルは422、ロード失敗は503。APIキーの認証は既存と共通。

`GET /testjeff/status` のready/selectedで利用可能状態を確認する。評価リクエストでは実モデル名を固定し、他画面の切り替えによる異なるモデルの結果が同一集計に混ざることを防ぐ。Aはabstract-nouns.jsonの46分類。ブラウザー集計はtestjeff-nouns-stats-v1キーにモデル別のruns/count/totalMs/probabilitySumを保存し、1回10件成功した場合のみ更新する。

## 可変件数と問い合わせ速度比較（v0.18.0）

対戦と `/query-comparison` は1・10・30・100件を選択する。API・保存スキーマは1〜100件を受け、候補・完了結果・ユーザー評価の件数を一致させる。`/testjeff/battle-batch` は最大8件の質問へ分割し、ローカルの省メモリ逐次推論を維持する。Lunaは1回のCLI呼び出しで指定数の真偽値を要求し、出力数を別途検証する。

モデル別の `run.query_totals` は `total_ms`（最初の本問い合わせ開始〜最終応答）、`response_sum_ms`（成功API時間の合計）、`count`、`complete` を持つ。読み込み・予備判定・保存は合計から除外する。比較ページは測定中に全結果表を描画し直さず、進捗だけ更新する。

比較は既存の `battle_runs` テーブルへ2記録を保存する。`run.parameters` の `comparison_id`、`comparison_mode`、`method_order`、`candidate_count` で関連付け、`GET /testjeff/battle-runs?comparison_only=true` で一覧を抽出する。通常の対戦履歴にも表示される。単件保存は冪等であり、片方の保存失敗では未保存側だけ再試行する。結果JSONをダウンロードするときに画面変更後の設定を混ぜない。

対戦と品質評価のPOST上限は8MiB。100件の完全な再現情報を保持するための拡張であり、画像や秘密値は追加しない。ブラウザーの非Luna一括期限は `15000 + ceil(件数 / 8) * 120000` ms、Lunaと単件は135000ms。期限は `TestJeffConnection.timeoutMs(path, payload)` で共通化しJSONにも保存する。

単体検証は `.venv/Scripts/python.exe -m unittest discover -s tests -p '*_test.py'` と `npm test`。模擬APIのブラウザー検証は `node tests/battle-count-browser.cjs` と `node tests/query-comparison-browser.cjs`。実APIの検証用に `tests/query-count-live-browser.cjs` と `tests/query-comparison-live-browser.cjs` を用意した。後者2本は専用DBを設定したポート8766のCPU試験サーバーが必要で、本番DBでは実行しない。比較試験のFDSは8767のQwen 2Bを使い、Lunaの実問い合わせは行わない。

## 個別・一括の同一入力比較（v0.20.3）

`noun-v2` は共通state「名詞の一般的な意味に基づいて判定してください。」と「B」は「A」ですか？という質問、Aを含む同一の真偽基準を使う。JavaScriptのnouns-core.jsとPythonのnoun_requests.pyを契約試験で照合する。名詞判定とモデル対戦も同じ生成処理を使う。

速度比較では実際のreproductionから候補別のstate・質問・選択肢・orders・画像を照合する。質問IDだけの違いは許可し、文面差や証跡不足は短縮率・倍率を計算しない。旧結果の合計時間と記録は残す。Lunaは生成形式の違いを含む方式比較のままで、Jeffの同一入力検査とは区別する。

FDSへの10件の通信は個別10回、一括2回（8件＋2件）。両方式ともモデル内部は1件ずつ計算する。通信回数だけで全体が5倍速くなるわけではない。モデル入力トークン数をexecutionに保存し、未提供時はnullとする。

常駐CPU3モデルでの再測定は `.venv/Scripts/python.exe dev/testing/noun_transport_benchmark.py --phase after`。TestJeffは8765、FDSは8767。CPUモデルがすべて常駐し、他の要求がないことを先に確認する。モデルのロード・解放要求はせず、解放しない設定で同じ10候補を各3回、方式の先後を交替して測る。予備判定・記録処理は計測外。生JSONはdev/testing/outputの日時別ファイルへ保存する。`--phase before` は旧版v0.20.2サーバー専用であり、新版では実行を拒否する。
