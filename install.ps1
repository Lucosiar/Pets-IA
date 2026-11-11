# Pets IA for Windows: downloads the latest release and runs `petsia setup`.
#   irm https://raw.githubusercontent.com/Lucosiar/Pets-IA/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$url = 'https://github.com/Lucosiar/Pets-IA/releases/latest/download/petsia-windows-x64.zip'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("petsia-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host 'Descargando Pets IA...'
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp 'petsia.zip') -UseBasicParsing
    Expand-Archive -Path (Join-Path $tmp 'petsia.zip') -DestinationPath $tmp -Force
    Get-ChildItem -Path $tmp -Recurse | Unblock-File
    & (Join-Path $tmp 'petsia.exe') setup
    if ($LASTEXITCODE -ne 0) { throw "petsia setup terminó con código $LASTEXITCODE" }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
