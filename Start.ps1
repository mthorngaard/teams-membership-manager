param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'

# Locate normal installations first, then the Node runtime bundled with Codex.
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $nodePath) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    )
    $nodePath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $nodePath) { throw 'Node.js was not found. Install Node.js 22 or newer, and try again.' }
$nodeVersion = & $nodePath -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.Split('.')[0]) -lt 22) { throw 'The app requires Node.js 22 or newer.' }

$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
$pwshPath = if ($pwshCommand) { $pwshCommand.Source } else { Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe' }
if (-not (Test-Path -LiteralPath $pwshPath)) { throw 'PowerShell 7 was not found. Install PowerShell 7, and try again.' }

& $pwshPath -NoLogo -NoProfile -File (Join-Path $PSScriptRoot 'ensure-graph.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Preparing the Graph module failed.' }
Write-Host "Node.js $nodeVersion is ready."
if ($CheckOnly) { return }

# Make PowerShell available to the Graph worker, even when absent from the user's PATH.
$previousPath = $env:PATH
try {
    $env:PATH = (Split-Path -Parent $pwshPath) + [IO.Path]::PathSeparator + $previousPath
    Write-Host 'Open the app in a browser at http://localhost:3000. Stop with Ctrl+C.'
    & $nodePath (Join-Path $PSScriptRoot 'server.js')
    if ($LASTEXITCODE -ne 0) { throw 'The web server stopped with an error. See the message above.' }
} finally {
    $env:PATH = $previousPath
}
