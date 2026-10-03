# TestJeff

JeffのJev互換APIをWindows / NVIDIA GPUで試す実験環境です。Pythonはこのフォルダの `.venv` のみを使います。公式 [firelex/jeff](https://github.com/firelex/jeff) を `vendor/jeff` に取得済みです。

## 起動

```powershell
cd C:\develop\test\TestJeff
pwsh -NoProfile -File .\dev\scripts\jeff.ps1 serve --model qwen-0.8b
```

起動後 [実験画面](http://127.0.0.1:8765) を開きます。公式画面の `Context` に状況、`Questions · JSON` に質問を入力し、`Run prediction` で実行します。
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
GPUメモリ不足時は小さいモデルを使うか、起動時に `--device cpu` を付けます。CPU経路は用意していますが今回の実測対象外で、GPUより遅くなります。
1モデルずつ常駐、質問は1件ずつ推論、最大4質問、本文32KiBまで、画像なし。PyTorchの割り当て上限をGPU総容量の85%にしています。ほかのGPUアプリの使用量や入力長によってはメモリ不足になるため、その場合は503を返します。

## APIを試す

別のpwshで実行します。

```powershell
cd C:\develop\test\TestJeff
$request = @{
  model = 'jeff-latest'
  state = '近所のスーパーに歩いて行きます。外は雨が降っています。玄関には傘、サングラス、本があります。'
  questions = @{
    intent = @{
      type = 'choice'
      instructions = '雨にぬれないために、持っていくものを選んでください。'
      criteria = @{ '1' = '傘'; '2' = 'サングラス'; '3' = '本' }
    }
  }
} | ConvertTo-Json -Depth 8
Invoke-RestMethod http://127.0.0.1:8765/v1/systemone -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($request)) | ConvertTo-Json -Depth 10
```

`choice`は選択肢ごとの確率、`noul`は真である確率、`score`は定義した段階のスコアを返します。文章を生成するチャットAPIではありません。`model: jeff-latest` は現在起動中のモデルを指し、このフィールドを書き換えるだけではベースモデルは切り替わりません。

サンプルは [tests/requests.json](tests/requests.json) にあります。状況・質問・選択肢はすべて日本語です。APIのフィールド名と型名は規定のままです。

| 場面 | 判定すること |
|---|---|
| 雨の日の外出 | 雨にぬれないために持っていくもの |
| 帰り道の買い物 | 家族に頼まれた買い物 |
| 洗濯物が乾いた日のひと言 | 洗濯が終わったか、気持ち、伝えていること |
| 出かける前の鍵探し | 家族の話から最初に探す場所（順序反転も実施） |

ブラウザーでは各サンプルの `request.state` を `Context`（Text）、`request.questions` のオブジェクトを `Questions · JSON` へ貼り付けて試せます。公式画面にもともと付いている英語のプリセットは上流提供のものです。本件の日本語サンプルは上記ファイルとsmoke/verifyで使用します。

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
