# End-to-end check on a Windows runner: install from dist, fire hooks exactly as Claude Code and Codex
# would (their commands, their shells), then screenshot the strip.
$ErrorActionPreference = 'Stop'
$dist = Resolve-Path 'dist/petsia-windows-x64'
New-Item -ItemType Directory -Force -Path "$HOME\.claude", "$HOME\.codex" | Out-Null

& "$dist\petsia.exe" setup
if ($LASTEXITCODE -ne 0) { throw "setup failed" }
$bin = "$env:LOCALAPPDATA\PetsIA\bin\petsia.exe"

# The overlay starts the agent; give it a moment.
for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-RestMethod http://127.0.0.1:7788/health | Out-Null; break } catch { Start-Sleep 1 }
}

$claude = (Get-Content "$HOME\.claude\settings.json" -Raw | ConvertFrom-Json).hooks.UserPromptSubmit[0].hooks[0].command
$codex = (Get-Content "$HOME\.codex\hooks.json" -Raw | ConvertFrom-Json).hooks.PermissionRequest[0].hooks[0].command
Write-Host "claude hook: $claude"
Write-Host "codex hook:  $codex"

$claudeEvent = '{"hook_event_name":"UserPromptSubmit","session_id":"0603472f-b7c5-4dae-b7a1-142468264b30","cwd":"C:\\w\\web"}'
$codexEvent = '{"hook_event_name":"PermissionRequest","session_id":"019dabc6-8fef-7681-a054-b5bb75fcb97d","cwd":"C:\\w\\app","tool_name":"Bash","tool_input":{"command":"npm test"}}'
$codexStop = '{"hook_event_name":"Stop","session_id":"019dabc6-8fef-7681-a054-b5bb75fcb97e","cwd":"C:\\w\\api"}'

# Claude Code runs hooks with Git Bash.
$claudeEvent | & 'C:\Program Files\Git\bin\bash.exe' -c $claude
if ($LASTEXITCODE -ne 0) { throw "claude hook exited $LASTEXITCODE" }
# Codex runs them with the native interpreter: try both cmd and PowerShell.
$codexEvent | cmd.exe /d /s /c $codex
if ($LASTEXITCODE -ne 0) { throw "codex hook (cmd) exited $LASTEXITCODE" }
$codexStop | powershell.exe -NoProfile -Command $codex
if ($LASTEXITCODE -ne 0) { throw "codex hook (powershell) exited $LASTEXITCODE" }

Start-Sleep 3
& $bin status
$health = Invoke-RestMethod http://127.0.0.1:7788/health
Write-Host "sessions: $($health.sessions)"

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$shot = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
[System.Drawing.Graphics]::FromImage($shot).CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
New-Item -ItemType Directory -Force -Path e2e | Out-Null
$shot.Save("$PWD\e2e\windows.png")
Copy-Item "$env:LOCALAPPDATA\PetsIA\logs\*" e2e -ErrorAction SilentlyContinue
Get-ChildItem e2e

if ($health.sessions -lt 3) { throw "expected 3 sessions, got $($health.sessions)" }
if (-not (Get-Process petsia-overlay -ErrorAction SilentlyContinue)) { throw "overlay is not running" }
if (Test-Path "$env:LOCALAPPDATA\PetsIA\logs\overlay.log") { Get-Content "$env:LOCALAPPDATA\PetsIA\logs\overlay.log"; throw "overlay logged errors" }

& $bin uninstall --purge
