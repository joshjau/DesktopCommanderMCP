param([switch]$FromShortcut)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    # This tracked wrapper is copied to the existing per-user shortcut directory.
    # Only the machine's reviewed commit selection is local configuration.
    $selection = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'approved-release.json') -Raw | ConvertFrom-Json
    if ($selection.sourceCommit -notmatch '^[0-9a-f]{40}$' -or
        [string]::IsNullOrWhiteSpace($selection.nodePath)) {
        throw 'The approved source release selection is invalid.'
    }
    $releaseRoot = Join-Path $PSScriptRoot ('releases\' + $selection.sourceCommit)
    & (Join-Path $releaseRoot 'scripts\start-reviewed-remote.ps1') -NodePath $selection.nodePath -FromShortcut:$FromShortcut
    exit $LASTEXITCODE
} catch {
    Write-Host ('Desktop Commander Remote could not start: ' + $_.Exception.Message)
    if ($FromShortcut) { Read-Host 'Press Enter to close this window' | Out-Null }
    exit 1
}
