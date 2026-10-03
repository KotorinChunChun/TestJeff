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
| 改造・再現 | docs/DEVELOPERS_GUIDE.md、src/testjeff.py、models.json |
| 実装計画 | dev/history/v0.1.0/v0.1.0-imp.md |
| 実測 | dev/testing/RESULTS.md |
| 配布 | dev/RELEASE_RULE.md |
