$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
Set-Location (Resolve-Path "$PSScriptRoot/../..")
$env:UV_CACHE_DIR = "$PWD/.cache/uv"
git submodule update --init --recursive
if (-not (Test-Path .venv/Scripts/python.exe)) { uv venv --python 3.12 .venv }
uv pip install --python .venv/Scripts/python.exe -e vendor/jeff
# CUDAインデックスから他の依存を取り直さない。
uv pip install --python .venv/Scripts/python.exe --no-deps torch==2.14.0+cu130 torchvision==0.29.0+cu130 --index-url https://download.pytorch.org/whl/cu130
uv pip check --python .venv/Scripts/python.exe
& .venv/Scripts/python.exe -c "import torch; assert torch.cuda.is_available(); print(torch.__version__, torch.cuda.get_device_name()); print(torch.ones(1,device='cuda').item())"
