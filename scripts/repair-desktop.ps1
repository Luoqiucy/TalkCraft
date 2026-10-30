# 2026-09-16纠正：SDK已存在，缺失的是MSVC普通x64目录下的msvcrt.lib。
Write-Output '请打开 Visual Studio Installer，找到 Community 2022，点击 更多 > 修复。'
Write-Output '这会重新核验并恢复安装文件；不要继续使用旧版SDK补装命令。'
Write-Output '完成后在项目目录运行 npm run desktop:doctor。'
