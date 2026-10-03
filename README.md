# TestJeff

JeffのJev互換APIをWindows / NVIDIA GPUで試す実験環境です。Pythonはこのフォルダの `.venv` のみを使います。公式 [firelex/jeff](https://github.com/firelex/jeff) を `vendor/jeff` に取得済みです。

## 名詞判定

[名詞判定画面](http://127.0.0.1:8765/nouns)で「ランダム生成」を押すと、分類名から質問のA、1,000語から候補Bを10語抽選し、「これはAですか？」を全候補について自動評価します。候補Bは同じ回の中で重複しません。「はい」の確率、50%以上なら「はい」・未満なら「いいえ」、各候補の応答時間を表示します。

Aは「動物」「食べ物」「家具」「道具」「自然物」などの分類名から選択します。候補Bを直接編集して「評価する」こともできます。「中止」で以後の送信を止めます（サーバー側で開始済みの1件は完了する場合があります）。初期表示は「動物」に対する10語で、まだ評価していません。抽選は意味の関連性で絞らないため、無関係な組み合わせも出ます。

「モデル」でQwen 0.8B・Qwen 2B・Gemma E2Bを選択できます。旧モデルを解放してから読み込むため、同時常駐しません。切り替え中は入力と評価を止め、完了後に再び操作できます。モデルは同じサーバーを利用する画面全体で共通です。

ランダム生成が10件すべて正常完了するたび、モデル別に生成回数・累積件数・平均応答時間・平均「はい」確率を加算します。応答時間はブラウザーの送信開始からJSON受信まで（モデル読込時間は除外、推論の初回準備時間は含む）。各平均は累積合計÷累積件数です。中止・失敗した回、手動の「評価する」は加算しません。集計はブラウザー内に保存して再読み込み後も保持し、「集計をリセット」で選択モデルの分だけ消せます。

候補Bは [src/data/nouns.json](src/data/nouns.json) に25分類・各40語、計1,000語を収録しています。Aは [src/data/abstract-nouns.json](src/data/abstract-nouns.json) の分類名に限定しています。辞書の分類は整理用で、推論の正解としては使いません。評価は選択したモデル名を明示して1件ずつ送信し、別の画面で途中にモデルを変更した場合はその回を集計しません。

## 起動

```powershell
cd C:\develop\test\TestJeff
pwsh -NoProfile -File .\dev\scripts\jeff.ps1 serve --model qwen-0.8b
```

起動後 [実験画面](http://127.0.0.1:8765) を開きます。日本語のサンプルボタンを選ぶと「状況」「質問」が入り、「判定する」で実行できます。「選択肢の順序」では通常判定と順序反転平均を切り替えられます。
モデルは名詞判定画面から切り替えられます。起動時に指定する場合は `Ctrl+C` で終了してから、次のいずれかで起動します。同じポートの二重起動は拒否します。

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
| まだ届いていない荷物 | 配達完了の真偽（いいえ） |
| 電車に乗り遅れた朝 | 気持ちのスコア（不満） |
| いつもどおりの昼休み | 気持ちのスコア（中立） |

ブラウザーの全7サンプルとsmoke/verifyは、同じtests/requests.jsonを使用します。状況・質問・選択肢・結果の見出し・ボタン・接続状態は日本語です。真偽の両方向、気持ちの3段階、単一／複数質問、順序反転を試せます。APIのフィールド名・型名・JSONは仕様のまま維持しています。

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
