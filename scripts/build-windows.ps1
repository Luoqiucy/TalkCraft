$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$debugRoot = Join-Path $projectRoot 'src-tauri\target\debug'
$destination = Join-Path $debugRoot 'TalkCraft.exe'
$applicationPattern = '^(TalkCraft(?:-.*)?|wireless-ai-mic)\.exe$'
# A running application must be closed by the user, never terminated by this script.
$running = Get-Process | Where-Object {
    $_.Path -and [IO.Path]::GetDirectoryName($_.Path) -eq $debugRoot -and
    [IO.Path]::GetFileName($_.Path) -match $applicationPattern
}
if ($running) { throw '请先保存录音并退出正在运行的 TalkCraft，再更新桌面程序。' }
& npm --prefix $projectRoot run react:check
if ($LASTEXITCODE -ne 0) { throw 'React 类型检查失败，上一版应用保持不变。' }
& npm --prefix $projectRoot run react:build
if ($LASTEXITCODE -ne 0) { throw 'React 前端构建失败，上一版应用保持不变。' }
$stagingRoot = Join-Path $projectRoot ('.local\windows-build-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
$stagingExe = Join-Path $stagingRoot 'TalkCraft.exe'
$stagingHookDll = Join-Path $stagingRoot 'TalkCraftKeyboardHook.dll'
$previousCargoHome = $env:CARGO_HOME
$previousRustupHome = $env:RUSTUP_HOME
try {
    $env:CARGO_HOME = Join-Path $projectRoot '.tools\cargo'
    $env:RUSTUP_HOME = Join-Path $projectRoot '.tools\rustup'
    & (Join-Path $projectRoot '.tools\cargo\bin\cargo.exe') rustc --locked --manifest-path (Join-Path $projectRoot 'src-tauri\keyboard-hook\Cargo.toml') --lib --target x86_64-pc-windows-msvc -- "--emit=link=$stagingHookDll"
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $stagingHookDll)) { throw '键盘钩子组件构建失败，上一版应用保持不变。' }
    & (Join-Path $projectRoot '.tools\cargo\bin\cargo.exe') rustc --locked --manifest-path (Join-Path $projectRoot 'src-tauri\Cargo.toml') --bin talkcraft-desktop -- "--emit=link=$stagingExe"
    if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath $stagingExe)) { throw '构建失败，上一版应用保持不变。' }
    Move-Item -LiteralPath $stagingHookDll -Destination (Join-Path $debugRoot 'TalkCraftKeyboardHook.dll') -Force
    Move-Item -LiteralPath $stagingExe -Destination $destination -Force
    Get-ChildItem -LiteralPath $debugRoot -File -Filter '*.exe' |
        Where-Object { $_.Name -match $applicationPattern -and $_.FullName -ne $destination } |
        ForEach-Object {
            if ($_.DirectoryName -ne $debugRoot) { throw '清理路径超出限定目录。' }
            Remove-Item -LiteralPath $_.FullName
        }
    Write-Output "最新应用：$destination"
} finally {
    $env:CARGO_HOME = $previousCargoHome
    $env:RUSTUP_HOME = $previousRustupHome
    if (Test-Path -LiteralPath $stagingExe) { Remove-Item -LiteralPath $stagingExe }
    $stagingPdb = Join-Path $stagingRoot 'TalkCraft.pdb'
    if (Test-Path -LiteralPath $stagingPdb) { Remove-Item -LiteralPath $stagingPdb }
    if (Test-Path -LiteralPath $stagingHookDll) { Remove-Item -LiteralPath $stagingHookDll }
    foreach ($hookSidecar in @('TalkCraftKeyboardHook.dll.lib', 'TalkCraftKeyboardHook.dll.exp', 'TalkCraftKeyboardHook.pdb')) {
        $hookSidecarPath = Join-Path $stagingRoot $hookSidecar
        if (Test-Path -LiteralPath $hookSidecarPath) { Remove-Item -LiteralPath $hookSidecarPath }
    }
    # Remove only this newly-created, empty staging directory. Never recurse.
    if (!(Get-ChildItem -LiteralPath $stagingRoot -Force)) { Remove-Item -LiteralPath $stagingRoot }
}
