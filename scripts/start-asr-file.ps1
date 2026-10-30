$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectPath
try {
    Write-Host '读取 .local/asr-test.env；打开 http://127.0.0.1:4318；Ctrl+C退出。'
    node scripts/asr-file.mjs
} finally { Pop-Location }
