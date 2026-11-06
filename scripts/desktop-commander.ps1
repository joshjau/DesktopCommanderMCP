# Normal Windows command entry point for this maintained checkout.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$cliArgs = @($args)
$mutex = $null
$ownsMutex = $false
try {
    $root = Split-Path -Parent $PSScriptRoot
    $nodeVersion = (Get-Content -LiteralPath (Join-Path $root '.node-version') -Raw).Trim()
    $package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
    $npmPin = [regex]::Match($package.packageManager, '^npm@(\d+\.\d+\.\d+)$')
    if ($nodeVersion -notmatch '^\d+\.\d+\.\d+$' -or -not $npmPin.Success) {
        throw 'The checkout has invalid Node/npm pins.'
    }
    $node = Join-Path $env:LOCALAPPDATA ("DevToolchains\node\node-v$nodeVersion-npm$($npmPin.Groups[1].Value)-win-x64\node.exe")
    $entry = Join-Path $root 'dist\index.js'
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'The checkout''s pinned Node runtime is missing.' }
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Build the checkout with npm run build first.' }
    $actualNodeVersion = & $node --version
    if ($LASTEXITCODE -ne 0 -or $actualNodeVersion -ne ('v' + $nodeVersion)) { throw 'The selected Node version does not match the checkout.' }
    $env:PATH = (Split-Path -Parent $node) + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

    $startsAgent = $cliArgs.Count -gt 0 -and $cliArgs[0] -ceq 'remote' -and
        -not @($cliArgs | Where-Object { $_ -cin @('--help', '-h', '--report', '--logout') }).Count
    if ($startsAgent) {
        $mutex = [Threading.Mutex]::new($false, ('Local\DesktopCommanderRemote-' + $env:USERNAME.ToLowerInvariant()))
        try { $ownsMutex = $mutex.WaitOne(0) }
        catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
        $running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop |
            Where-Object {
                $_.CommandLine -match '(?i)[\\/]dist[\\/]index\.js"?\s+remote(?:\s|$)' -or
                $_.CommandLine -match '(?i)npx-cli\.js"?\s+.*@wonderwhy-er[\\/]desktop-commander(?:@[^\s"]+)?\s+remote(?:\s|$)'
            })
        if (-not $ownsMutex -or $running.Count) {
            Write-Host 'Desktop Commander Remote is already running. No second agent was started.'
            exit 0
        }
    }
    & $node $entry @cliArgs
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('Desktop Commander: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
