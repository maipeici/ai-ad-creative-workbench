param(
  [switch]$NoBrowser,
  [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$taskAppRoot = Split-Path -Parent $PSScriptRoot
$taskNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$taskNode = if ($taskNodeCommand) { $taskNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }

function Test-Workbench {
  try {
    $result = Invoke-RestMethod ($taskUrl + '/api/meta') -TimeoutSec 2
    return [bool]($result.phases -and $result.brandGuide)
  } catch { return $false }
}

try {
  if (!(Test-Path -LiteralPath $taskNode)) { throw 'Node.js was not found. Install Node.js 22 or 24 first.' }
  if (!(Test-Path -LiteralPath (Join-Path $taskAppRoot 'node_modules\vite\bin\vite.js'))) { throw 'Dependencies are missing. Run npm ci from the repository root first.' }
  Push-Location $taskAppRoot
  try {
    $taskPort = & $taskNode --input-type=module -e "import { config } from './src/server/config.js'; console.log(config.port)"
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the application configuration.' }
  } finally { Pop-Location }
  $taskPortNumber = 0
  if (![int]::TryParse(($taskPort | Out-String).Trim(), [ref]$taskPortNumber) -or $taskPortNumber -lt 1 -or $taskPortNumber -gt 65535) { throw 'PORT must be an integer between 1 and 65535.' }
  $taskUrl = 'http://localhost:' + $taskPortNumber

  if (!(Test-Workbench)) {
    Push-Location $taskAppRoot
    try {
      & $taskNode 'node_modules\vite\bin\vite.js' build --config config/vite.config.ts
      if ($LASTEXITCODE -ne 0) { throw 'The frontend build failed. See the output above.' }
    } finally { Pop-Location }
    $taskLogDirectory = Join-Path $taskAppRoot '.local'
    New-Item -ItemType Directory -Force -Path $taskLogDirectory | Out-Null
    $taskProcess = Start-Process -FilePath $taskNode -ArgumentList 'src/server/index.js' -WorkingDirectory $taskAppRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogDirectory 'server.log') -RedirectStandardError (Join-Path $taskLogDirectory 'server-error.log') -PassThru
    $taskProcess.Id | Set-Content -LiteralPath (Join-Path $taskLogDirectory 'server.pid')
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
      if (Test-Workbench) { $taskReady = $true; break }
      $taskProcess.Refresh()
      if ($taskProcess.HasExited) { throw ('The server exited. Check ' + (Join-Path $taskLogDirectory 'server-error.log')) }
      Start-Sleep -Milliseconds 500
    }
    if (!$taskReady) { throw ('Startup timed out. Check port ' + $taskPortNumber + ' and the server logs.') }
  }
  if (!$NoBrowser) { Start-Process $taskUrl }
  Write-Host ('Workbench ready: ' + $taskUrl)
} catch {
  Write-Host ('Startup failed: ' + $_.Exception.Message) -ForegroundColor Red
  if (!$NonInteractive) { Read-Host 'Press Enter to close' }
  exit 1
}
