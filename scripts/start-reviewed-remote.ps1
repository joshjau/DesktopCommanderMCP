param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [switch]$FromShortcut
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Show-LauncherMessage([string]$Message) {
    Write-Host $Message
    if ($FromShortcut) { Read-Host 'Press Enter to close this window' | Out-Null }
}

$mutex = [Threading.Mutex]::new($false, ('Local\DesktopCommanderRemote-' + $env:USERNAME.ToLowerInvariant()))
$ownsMutex = $false
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) {
        Show-LauncherMessage 'Desktop Commander Remote is already running or starting. No second agent was launched.'
        exit 0
    }

    # Include the official npx agent and reviewed source builds. Fail closed if inspection fails.
    $runningAgents = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
        Where-Object {
            $_.CommandLine -match '(?i)[\\/]dist[\\/]index\.js"?\s+remote(?:\s|$)' -or
            $_.CommandLine -match '(?i)npx-cli\.js"?\s+.*@wonderwhy-er[\\/]desktop-commander(?:@[^\s"]+)?\s+remote(?:\s|$)'
        })
    if ($runningAgents.Count -gt 0) {
        Show-LauncherMessage 'Desktop Commander Remote is already running or starting. No second agent was launched.'
        exit 0
    }

    $releaseRoot = Split-Path -Parent $PSScriptRoot
    $receiptPath = Join-Path $releaseRoot 'release-receipt.json'
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    if ($receipt.sourceCommit -notmatch '^[0-9a-f]{40}$' -or
        (Split-Path -Leaf $releaseRoot) -ne $receipt.sourceCommit) {
        throw 'This launcher requires an installed, validated source release.'
    }
    $requiredFiles = @('package.json', 'package-lock.json', '.node-version', 'scripts/start-reviewed-remote.ps1',
        'dist/index.js', 'dist/tools/json-schema.js',
        'dist/ui/file-preview/preview-runtime.js', 'dist/ui/file-preview/build-provenance.json',
        'dist/ui/config-editor/config-editor-runtime.js', 'dist/ui/config-editor/build-provenance.json')
    foreach ($requiredFile in $requiredFiles) {
        if ($null -eq $receipt.files.PSObject.Properties[$requiredFile]) {
            throw "Release receipt is incomplete: $requiredFile"
        }
    }
    foreach ($file in $receipt.files.PSObject.Properties) {
        if ($file.Value -notmatch '^[0-9a-f]{64}$') { throw 'Release receipt contains an invalid SHA256 hash.' }
        $target = [IO.Path]::GetFullPath((Join-Path $releaseRoot $file.Name))
        if (-not $target.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Release receipt contains a path outside the release.'
        }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.Value) {
            throw "Release verification failed: $($file.Name)"
        }
    }
    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'The reviewed Node executable is missing.' }
    $expectedVersion = (Get-Content -LiteralPath (Join-Path $releaseRoot '.node-version') -Raw).Trim()
    $actualVersion = & $NodePath --version
    if ($LASTEXITCODE -ne 0 -or $actualVersion -ne ('v' + $expectedVersion)) { throw 'The reviewed Node version is required.' }

    $env:PATH = (Split-Path -Parent $NodePath) + ';' + [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User')
    Set-Location -LiteralPath $env:USERPROFILE
    Write-Host "Starting reviewed Desktop Commander source $($receipt.sourceCommit.Substring(0,12))."
    & $NodePath (Join-Path $releaseRoot 'dist\index.js') remote
    $agentExitCode = $LASTEXITCODE
    if ($agentExitCode -ne 0) { Show-LauncherMessage "Desktop Commander Remote exited with code $agentExitCode." }
    exit $agentExitCode
} catch {
    Show-LauncherMessage ("Desktop Commander Remote could not start: " + $_.Exception.Message)
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
