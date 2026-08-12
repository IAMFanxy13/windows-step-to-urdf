param([int]$PreferredPort = 5173, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$appDataRoot = Join-Path $env:LOCALAPPDATA 'StepToUrdf'
$runtimeRoot = Join-Path $appDataRoot 'runtime'
$logRoot = Join-Path $appDataRoot 'logs'
$jobsRoot = Join-Path $appDataRoot 'jobs'
$venvRoot = Join-Path $runtimeRoot 'python'
$pythonExe = Join-Path $venvRoot 'Scripts\python.exe'
New-Item -ItemType Directory -Force -Path $runtimeRoot,$logRoot,$jobsRoot | Out-Null
$logFile = Join-Path $logRoot ("launcher-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))

function Write-LauncherLog([string]$Message) {
  $safe = $Message -replace [regex]::Escape($env:USERPROFILE), '<USERPROFILE>'
  Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ("[{0}] {1}" -f (Get-Date -Format s),$safe)
}

try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Node.js is missing. This source candidate is not a dependency-free installer; install the version listed in README.'
  }
  if (-not (Test-Path -LiteralPath $pythonExe)) {
    $systemPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $systemPython) { throw 'Python is missing. This source candidate is not a dependency-free installer; install the version listed in README.' }
    Write-Host 'First start: creating an isolated STEP analysis environment...'
    & $systemPython.Source -m venv $venvRoot
    & $pythonExe -m pip install --disable-pip-version-check -r (Join-Path $projectRoot 'requirements-step.txt')
  }
  & $pythonExe -c 'from OCP.STEPCAFControl import STEPCAFControl_Reader' 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'The STEP analysis runtime check failed. See the launcher log.' }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\.bin\vite.cmd'))) {
    Write-Host 'First start: installing locked web dependencies...'
    Push-Location $projectRoot
    try { & npm ci --ignore-scripts } finally { Pop-Location }
  }

  $port = $PreferredPort
  while ($port -lt ($PreferredPort + 20) -and (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { $port++ }
  if ($port -ge ($PreferredPort + 20)) { throw 'No free local port was found in the permitted range.' }
  $env:STEP_URDF_PYTHON = $pythonExe
  $env:STEP_URDF_JOBS_ROOT = $jobsRoot
  $stdout = Join-Path $logRoot 'server.stdout.log'
  $stderr = Join-Path $logRoot 'server.stderr.log'
  $args = @('run','dev','--','--port',"$port",'--strictPort')
  $npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
  $process = Start-Process -FilePath $npmCommand -ArgumentList $args -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $url = "http://127.0.0.1:$port/"
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { if ((Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1).StatusCode -eq 200) { break } } catch { Start-Sleep -Milliseconds 250 }
  }
  if ($process.HasExited) { throw 'The local service failed to start. See server.stderr.log.' }
  Write-LauncherLog "Started PID $($process.Id) on $url; jobs=$jobsRoot"
  if (-not $NoBrowser) { Start-Process $url }
  Write-Host "STEP-to-URDF opened. Logs: $logRoot"
} catch {
  Write-LauncherLog $_.Exception.Message
  Write-Error $_.Exception.Message
  exit 1
}
