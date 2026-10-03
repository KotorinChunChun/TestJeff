$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot/../..")
if (-not (Test-Path .venv/Scripts/python.exe)) { throw '先にdev/scripts/setup.ps1を実行してください。' }
$env:PYTHONUTF8 = '1'
& .venv/Scripts/python.exe src/testjeff.py @args
exit $LASTEXITCODE
