$ErrorActionPreference = 'Stop'
$taskAppRoot = $PSScriptRoot
$taskUrl = 'http://localhost:8787'
function Test-Workbench {
  try {
    $result = Invoke-RestMethod ($taskUrl + '/api/meta') -TimeoutSec 2
    return [bool]($result.phases -and $result.brandGuide)
  } catch { return $false }
}
try {
  if (!(Test-Workbench)) {
    $taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $taskNode = if ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
    if (!(Test-Path -LiteralPath $taskNode)) { throw '未找到 Node.js，请先安装 Node.js 20.19 或更新版本。' }
    if (!(Test-Path -LiteralPath (Join-Path $taskAppRoot 'node_modules\vite\bin\vite.js'))) { throw '项目依赖尚未安装，请先在仓库根目录安装依赖。' }
    Push-Location $taskAppRoot
    try {
      & $taskNode 'node_modules\vite\bin\vite.js' build
      if ($LASTEXITCODE -ne 0) { throw '页面构建失败，请查看上方提示。' }
    } finally { Pop-Location }
    $taskLogDirectory = Join-Path $taskAppRoot '.local'
    New-Item -ItemType Directory -Force -Path $taskLogDirectory | Out-Null
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList 'server/index.js' -WorkingDirectory $taskAppRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogDirectory 'server.log') -RedirectStandardError (Join-Path $taskLogDirectory 'server-error.log') -PassThru
    $taskProcess.Id | Set-Content -LiteralPath (Join-Path $taskLogDirectory 'server.pid')
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
      if (Test-Workbench) { $taskReady = $true; break }
      if ($taskProcess.HasExited) { throw ('服务未能启动，请检查 ' + (Join-Path $taskLogDirectory 'server-error.log')) }
      Start-Sleep -Milliseconds 500
    }
    if (!$taskReady) { throw '服务启动超时，请检查 8787 端口是否被其他程序占用。' }
  }
  Start-Process $taskUrl
  Write-Host ('工作台已打开：' + $taskUrl)
} catch {
  Write-Host ('启动失败：' + $_.Exception.Message) -ForegroundColor Red
  Read-Host '按回车关闭'
  exit 1
}