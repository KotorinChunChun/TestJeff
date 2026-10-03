# TestJeff

JeffのJev互換APIをWindows / NVIDIA GPUで試す実験環境です。Pythonはこのフォルダの `.venv` のみを使います。公式 [firelex/jeff](https://github.com/firelex/jeff) を `vendor/jeff` に取得済みです。

## 起動

```powershell
cd C:\develop\test\TestJeff
pwsh -NoProfile -File .\dev\scripts\jeff.ps1 serve --model qwen-0.8b
```

起動後 [実験画面](http://127.0.0.1:8765) を開きます。公式画面のJSON欄に入力し、`/v1/systemone` を実行できます。
モデルを切り替える場合は `Ctrl+C` で終了してから、次のいずれかで起動します。同じポートの二重起動は拒否します。

```powershell
pwsh -NoProfile -File .\dev\scripts\jeff.ps1 serve --model qwen-2b
pwsh -NoProfile -File .\dev\scripts\jeff.ps1 serve --model gemma-e2b
```

| 指定 | モデル | GPU空き容量の起動条件 |
|---|---|---|
| qwen-0.8b（既定） | Jeff-Qwen3.5-0.8B | 3GiB以上 |
| qwen-2b | Jeff-Qwen3.5-2B | 6GiB以上 |
| gemma-e2b | Jeff-Gemma4-E2B | 11GiB以上 |

空き容量は短文実験用の保守的な目安です。実測値は [検証結果](dev/testing/RESULTS.md) を参照してください。
GPUメモリ不足時は小さいモデルを使うか、起動時に `--device cpu` を付けます。CPUは遅くなります。
1モデルずつ常駐、質問は1件ずつ推論、最大4質問、本文32KiBまで、画像なし。PyTorchの割り当て上限をGPU総容量の85%にしています。ほかのGPUアプリの使用量や入力長によってはメモリ不足になるため、その場合は503を返します。

## APIを試す

別のpwshで実行します。

```powershell
cd C:\develop\test\TestJeff
$request = @{
  model = 'jeff-latest'
  state = @{ 発話 = '設定画面を開いてください' }
  questions = @{
    intent = @{
      type = 'choice'
      instructions = 'ユーザーが開きたい画面はどれですか。'
      criteria = @{ '1' = '受信トレイ'; '2' = '設定'; '3' = 'カレンダー' }
    }
  }
} | ConvertTo-Json -Depth 8
Invoke-RestMethod http://127.0.0.1:8765/v1/systemone -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($request)) | ConvertTo-Json -Depth 10
```

`choice`は選択肢ごとの確率、`noul`は真である確率、`score`は定義した段階のスコアを返します。文章を生成するチャットAPIではありません。`model: jeff-latest` は現在起動中のモデルを指し、このフィールドを書き換えるだけではベースモデルは切り替わりません。

## 再セットアップと検証

```powershell
cd C:\develop\test\TestJeff
pwsh -NoProfile -File .\dev\scripts\setup.ps1
pwsh -NoProfile -File .\dev\scripts\jeff.ps1 download --all
# 起動中のサーバーを停止してから、3モデルを順番に起動・API検証・終了する
pwsh -NoProfile -File .\dev\scripts\jeff.ps1 verify --all
# 起動済みのサーバーだけを調べる
pwsh -NoProfile -File .\dev\scripts\jeff.ps1 smoke
```

新規cloneには `git clone --recurse-submodules` を使います。モデルはGitには含まれません。ダウンロードは合計約15GB、CUDAライブラリ・キャッシュにも別途空き容量が必要です。モデルはmodels.jsonのリビジョンを使います。

`/health` は起動状態、`/v1/models` はAPI名、`/testjeff/status` は選択モデルとPyTorchのGPUメモリ実測を返します。`--port 8766` でポートを変えられます。待受は127.0.0.1のみです。

[開発者向け手順](docs/DEVELOPERS_GUIDE.md) / [検証結果](dev/testing/RESULTS.md)
