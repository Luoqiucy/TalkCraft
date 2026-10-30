$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot/..
$textSecret = $null
$textPointer = [IntPtr]::Zero
try {
  $textProvider = Read-Host '文字模型提供器：deepseek / openai / ark / ollama'
  $textModel = Read-Host '模型名称（填写账户可用模型或本机已下载模型）'
  $textKey = ''
  if ($textProvider -ne 'ollama') {
    $textSecret = Read-Host 'API Key（隐藏输入）' -AsSecureString
    $textPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($textSecret)
    $textKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($textPointer)
  }
  @{provider=$textProvider;model=$textModel;apiKey=$textKey} | ConvertTo-Json -Compress | node scripts/configure-text-file.mjs
  if ($LASTEXITCODE -ne 0) { throw '文字配置未完成' }
} finally {
  $textKey = $null
  if ($textPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($textPointer) }
  if ($textSecret) { $textSecret.Dispose() }
  Pop-Location
}

