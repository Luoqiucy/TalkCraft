$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$keys = @('ASR_PROVIDER','VOLC_ASR_APP_KEY','VOLC_ASR_ACCESS_KEY','VOLC_ASR_RESOURCE_ID','TEXT_PROVIDER','ASR_TIMEOUT_MS')
$saved = @{}
foreach ($key in $keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
$tokenPointer = [IntPtr]::Zero
try {
    $appId = Read-Host '输入豆包语音 APP ID'
    $secureToken = Read-Host '输入 Access Token（隐藏输入；不会保存到文件）' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $env:ASR_PROVIDER = 'volcengine'
    $env:VOLC_ASR_APP_KEY = $appId.Trim()
    $env:VOLC_ASR_ACCESS_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $env:VOLC_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration'
    $env:ASR_TIMEOUT_MS = '120000'
    $env:TEXT_PROVIDER = 'mock'
    Push-Location -LiteralPath $projectPath
    try {
        Write-Host '测试页面：http://127.0.0.1:4318；音频需确认上传；文字整理仍为模拟。Ctrl+C退出。'
        node --input-type=module -e "import {createServer} from './server.mjs'; const server=createServer(); server.on('error',()=>{console.error('测试服务启动失败：检查4318端口是否已占用');process.exitCode=1;}); server.listen(4318,'127.0.0.1');"
    } finally { Pop-Location }
} finally {
    if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
}
