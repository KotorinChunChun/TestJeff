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
