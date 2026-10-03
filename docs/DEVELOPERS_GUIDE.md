# 開発手順

Python 3.12、Git、uv、NVIDIAドライバーを使用する。専用 .venv 以外にパッケージをインストールしない。
`pwsh -NoProfile -File dev/scripts/setup.ps1` でセットアップする。
上流は vendor/jeff submodule、モデルリビジョンは models.json に固定する。
`pwsh -NoProfile -File dev/scripts/jeff.ps1 verify --all` で実HTTP試験を実行する。詳細はREADMEを参照する。
本件のJSON結果はdev/testing/outputへ出力し、要約だけをtesting/RESULTS.mdへ記録する。
