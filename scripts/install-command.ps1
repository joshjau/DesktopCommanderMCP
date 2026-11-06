$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'desktop-commander.ps1'
$bin = Join-Path $env:USERPROFILE '.local\bin'
$command = Join-Path $bin 'desktop-commander.cmd'
$content = "@echo off`r`n" +
    '"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo -NoProfile -File "' + $launcher + '" %*' + "`r`n" +
    'exit /b %errorlevel%' + "`r`n"
if ((Test-Path -LiteralPath $command) -and (Get-Content -LiteralPath $command -Raw) -ne $content) {
    throw 'A different desktop-commander command already exists; inspect it before replacing it.'
}
New-Item -ItemType Directory -Path $bin -Force | Out-Null
[IO.File]::WriteAllText($command, $content, [Text.UTF8Encoding]::new($false))
Write-Host 'Installed command: desktop-commander remote'
