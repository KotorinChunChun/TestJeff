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

日本語画面はsrc/playground.html。公式MIT版を元に本件用として管理し、上流submoduleは変更しない。`GET /testjeff/examples` でtests/requests.jsonを読み、すべてのプリセットを生成する。`node tests/playground.test.cjs` は画面スクリプトをDOM代替上で実行し、全サンプルの選択・送信内容・ordersの一致を確認する（実ブラウザーの描画試験とは区別する）。

名詞判定はsrc/nouns.html、nouns.js、nouns-core.js。GET /nounsとGET /testjeff/nounsを追加し、既存の/v1/systemoneへ候補ごとにnoulを送信する。辞書はsrc/data/nouns-source.txtとnouns.jsonの一致をテストで保つ。名詞を追加・変更するときは両方を更新する。

Node.jsはブラウザーテスト専用。`npm ci`、`npm test` で辞書と抽選、日本語画面の送信内容を確認できる。`node tests/nouns-browser.cjs` は既存Microsoft Edgeをヘッドレスで起動し、1クリックでの抽選・10件評価・逐次通信・空入力・中止・認証エラーを確認する。追加ブラウザーのダウンロードは不要。Playwrightの依存は本件内node_modulesへ分離する。

実モデルでのブラウザーテストは、サーバー起動後にpwshで `$env:LIVE_URL='http://127.0.0.1:8765'; node tests/nouns-browser.cjs` を実行する。現在の検証件数と切り替え順は次段落を参照する。JSONとパソコン幅・スマートフォン幅のスクリーンショットはdev/testing/outputへ保存する。

v0.3.0以降のブラウザーテストは計50件（0.8Bの手動10件＋ランダム20件、2B/Gemma各10件）。起動モデルを0.8Bにして実行し、最後に0.8Bへ戻す。モデル別の加算・平均値・再読込・リセット・中止/失敗除外も確認する。

`POST /testjeff/model` は `{"model":"qwen-2b"}` 等を受け取り、推論と同じservice.lockで排他する。旧モデルを解放・GC・CUDAキャッシュ解放後に次モデルをロードする。上流lifespanはモデルをローカル変数に保持するため、本件のlifespanはserviceだけにモデルを所有させる。同時切り替えは409、不正モデルは422、ロード失敗は503。APIキーの認証は既存と共通。

`GET /testjeff/status` のready/selectedで利用可能状態を確認する。評価リクエストでは実モデル名を固定し、他画面の切り替えによる異なるモデルの結果が同一集計に混ざることを防ぐ。Aはabstract-nouns.jsonの46分類。ブラウザー集計はtestjeff-nouns-stats-v1キーにモデル別のruns/count/totalMs/probabilitySumを保存し、1回10件成功した場合のみ更新する。
