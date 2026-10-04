# TestJeff 開発ルール

- 質問には回答のみ。明確な変更指示がある場合に実装する。
- PowerShellはpwsh、文書とコミットは日本語。コミットはfeat/fix/docs/chore等の接頭辞を付ける。
- Pythonは本件専用 .venv を必ず使用する。モデル・キャッシュも本件内に分離する。
- 大きな作業はフェーズ分割し、検証・コミット後に次へ進む。
- 公式コードはvendor/jeff submoduleで固定する。このフォルダは上流の構成を保つ。自作コードはsrc、起動手順はdev/scriptsに置く。
- 変更しない上流英語文書は翻訳しない。READMEは利用者向け、docsは公開開発者向け、devは本人の計画・判断・結果。
- 作業中のreq/imp/taskはdev直下、完了一式はdev/history/vX.Y.Zへ移す。未完事項は出典・引継ぎ先を双方に記録する。過去の未チェックだけで未実装扱いしない。
- dev/tempはプロジェクト外一時制作物、dev/privateは秘密情報用。両者、モデル、仮想環境、出力ログはGit・通常調査対象外。
- テンプレート取り込み用フォルダは保持しない。default原本は変更しない。
- private GitHubで管理する。新規作成・名称や起動情報変更時はC:/develop/default/dev/アプリ一覧.mdとC:/develop/DevLauncher/gui/CLI-Launcher.Gui/web-catalog.jsonを既存編集を保って更新する。登録手順はC:/develop/DevLauncher/docs/APP_CATALOG.md。
- 完了時、停止中ならcdパス付き起動コマンドを提示する。

## 目的別目録

必要な資料だけを読む。

| 目的 | 資料 |
|---|---|
| 利用 | README.md |
| 改造・再現 | docs/DEVELOPERS_GUIDE.md、src/testjeff.py、src/playground.html、models.json |
| 実装計画 | dev/history/v0.1.0/v0.1.0-imp.md |
| 実測 | dev/testing/RESULTS.md |
| 名詞判定 | src/nouns.html、src/nouns.js、src/nouns-core.js、src/data/nouns.json、tests/nouns.test.cjs、tests/nouns-browser.cjs |
| フィードバック記録 | src/feedback.py、tests/feedback_test.py、tests/feedback-browser.cjs、dev/history/v0.4.0/v0.4.0-imp.md |
| 使用量表示 | src/resources.py、tests/resources_test.py、tests/resources-browser.cjs、dev/history/v0.5.0/v0.5.0-imp.md |
| モデル対戦 | src/battle.html、src/battle.js、src/battle-core.js、tests/battle.test.cjs、tests/battle-browser.cjs、dev/history/v0.6.0/v0.6.0-imp.md |
| Codex CLI比較 | src/luna.py、src/luna-schema.json、tests/luna_test.py、dev/history/v0.7.0/v0.7.0-imp.md |
| 画像判定 | src/photos.py、src/photos.html、src/photos.js、tests/photos_test.py、tests/photos-browser.cjs、dev/history/v0.8.0/v0.8.0-imp.md |
| 画像サンプル・面積推定 | tests/photos-samples-browser.cjs、dev/history/v0.10.0/v0.10.0-imp.md |
| 二軸画像分類・SQLite画像履歴 | src/image_store.py、src/data/image_classification_definitions.json、tests/image_store_test.py、tests/image-history-browser.cjs、dev/history/v0.11.0/v0.11.0-imp.md |
| FDS接続切替 | src/fds_client.py、src/connection.js、tests/fds_client_test.py、tests/fds-browser.cjs、dev/history/v0.12.0/v0.12.0-imp.md |
| FDSモデル管理・解放承認 | src/fds_client.py、src/connection.js、tests/fds-management-browser.cjs、tests/fds-live-browser.cjs、dev/history/v0.20.0/v0.20.0-imp.md |
| FDS対戦・速度比較の順次切替 | tests/fds-sequential.test.cjs、dev/history/v0.20.1/v0.20.1-imp.md |
| 問い合わせ速度比較の自動保存 | src/query-autosave.js、tests/query-autosave.test.cjs、dev/testing/query_autosave_server.py、dev/history/v0.20.2/v0.20.2-imp.md |
| 個別・一括の入力統一とCPU実測 | src/noun_requests.py、tests/noun_requests_test.py、dev/testing/noun_transport_benchmark.py、dev/history/v0.20.3/v0.20.3-imp.md |
| 共通ヘッダー・メニュー専用トップ・サンプル実験 | src/connection.js、src/index.html、src/playground.html、tests/header-layout-browser.cjs、dev/history/v0.20.5/v0.20.5-imp.md |
| ローカルCPU/GPU・対戦入力保持 | src/connection.js、tests/local_device_test.py、tests/connection-local-browser.cjs、tests/local-device-live-browser.cjs、dev/history/v0.16.0/v0.16.0-imp.md |
| 対戦保存・全候補コンボ・JSON再現情報 | src/battle_store.py、src/noun-combo.js、src/reproduction.py、tests/battle_store_test.py、tests/battle-history-browser.cjs、tests/reproduction_test.py、tests/battle-storage-live-browser.cjs、dev/history/v0.17.0/v0.17.0-imp.md |
| 可変件数・問い合わせ速度比較 | src/query-comparison.html、src/query-comparison.js、src/query-comparison-core.js、tests/battle-count-browser.cjs、tests/query-comparison-browser.cjs、tests/battle_batch_test.py、dev/history/v0.18.0/v0.18.0-imp.md |
| 対戦表示・合計順位・不一致フィルター | src/battle.html、src/battle.js、src/battle-core.js、tests/battle.test.cjs、tests/battle-display-browser.cjs、dev/history/v0.19.0/v0.19.0-imp.md |
| 品質評価ナレッジ | src/knowledge.py、tests/knowledge_test.py、dev/history/v0.9.0/v0.9.0-imp.md |
| 配布 | dev/RELEASE_RULE.md |
