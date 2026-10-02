// Keep the helper compatible with Windows PowerShell 2 on Windows 7. All paths
// are JSON data, never generated command text. It only changes listed files.
export const UPDATE_RELAUNCH_SCRIPT = String.raw`param([string]$PlanFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$Serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$Serializer.MaxJsonLength = 16777216
$Utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Json($File, $Value) {
  # Pipeline strings carry PSObject metadata. A typed dictionary keeps the old
  # .NET serializer from reflecting that metadata or following circular links.
  $Plain = New-Object 'System.Collections.Generic.Dictionary[string,string]'
  foreach ($Key in $Value.Keys) { $Plain.Add([string]$Key, [string]$Value[$Key]) }
  [IO.File]::WriteAllText($File, $Serializer.Serialize($Plain), $Utf8)
}
function Read-Json($File) { return $Serializer.DeserializeObject([IO.File]::ReadAllText($File, $Utf8)) }
function Get-Sha256($File) {
  $Stream = [IO.File]::OpenRead($File)
  $Hash = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($Hash.ComputeHash($Stream)).Replace('-','').ToLowerInvariant() }
  finally { $Stream.Dispose(); $Hash.Dispose() }
}
function Assert-NoLinks($File) {
  $Current = [IO.Path]::GetFullPath($File)
  while ($Current) {
    if ([IO.File]::Exists($Current) -or [IO.Directory]::Exists($Current)) {
      if (([IO.File]::GetAttributes($Current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked update path' }
    }
    $Parent = [IO.Path]::GetDirectoryName($Current)
    if ($Parent -eq $Current) { break }
    $Current = $Parent
  }
}
function Under-Root($Root, $Relative) {
  if (!$Relative -or $Relative -match '[\\:\x00-\x1f"<>|?*]' -or $Relative.StartsWith('/')) { throw 'Invalid relative path' }
  foreach ($Part in $Relative.Split('/')) {
    if (!$Part -or $Part -eq '.' -or $Part -eq '..' -or $Part -match '[. ]$' -or $Part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)') { throw 'Invalid relative path' }
  }
  $Prefix = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  $Resolved = [IO.Path]::GetFullPath([IO.Path]::Combine($Root, $Relative))
  if (!$Resolved.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside update root' }
  Assert-NoLinks $Resolved
  return $Resolved
}
function Is-Managed($Name) {
  if ($Name -match '/') { return $Name -match '^(resources|locales|swiftshader|licenses)/' }
  return $Name -match '^(LX-M Music\.exe|LICENSE|LICENSE\.electron\.txt|LICENSES\.chromium\.html|version|vk_swiftshader_icd\.json)$' -or $Name -match '\.(dll|pak|bin|dat)$'
}
function Assert-NotCancelled {
  if ([IO.File]::Exists($PlanFile + '.cancel-' + $Plan.nonce)) { throw 'Update helper cancelled' }
}
function Start-App($Confirm) {
  foreach ($Name in @('PORTABLE_EXECUTABLE_FILE','PORTABLE_EXECUTABLE_DIR','PORTABLE_EXECUTABLE_APP_FILENAME','LX_M_UPDATE_CONFIRM')) { [Environment]::SetEnvironmentVariable($Name, $null, 'Process') }
  if ($Confirm) { [Environment]::SetEnvironmentVariable('LX_M_UPDATE_CONFIRM', $PlanFile, 'Process') }
  return Start-Process -FilePath $Plan.executable -WorkingDirectory $Plan.root -WindowStyle Hidden -PassThru
}
$Changed = New-Object System.Collections.ArrayList
$Committed = $false
$Plan = $null
try {
  $Plan = Read-Json $PlanFile
  $TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($PlanFile))
  if ($Plan.schema -ne 1 -or $Plan.nonce -notmatch '^[a-f0-9-]{36}$' -or [int]$Plan.oldPid -le 0 -or @('portable','single-file') -notcontains $Plan.kind) { throw 'Invalid update plan' }
  if ([IO.Path]::GetFileName($TempRoot) -notmatch '^lx-m-update-' -or [IO.Path]::GetFullPath($Plan.stage) -ne [IO.Path]::Combine($TempRoot, 'app')) { throw 'Invalid update staging directory' }
  if (![IO.Path]::IsPathRooted($Plan.root) -or [IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($Plan.executable)) -ne [IO.Path]::GetFullPath($Plan.root)) { throw 'Invalid application directory' }
  Assert-NoLinks $TempRoot
  Assert-NoLinks $Plan.root
  $ExecutableName = [IO.Path]::GetFileName($Plan.executable)
  $Seen = @{}
  foreach ($Entry in $Plan.files) {
    if ($Seen.ContainsKey($Entry.path.ToLowerInvariant()) -or $Entry.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid update file list' }
    $Seen[$Entry.path.ToLowerInvariant()] = $true
    if ($Plan.kind -eq 'single-file') { if ($Entry.path -ne $ExecutableName) { throw 'Wrong single-file target' } }
    elseif ($Entry.path -ne $ExecutableName -and !(Is-Managed $Entry.path)) { throw 'Unmanaged update target' }
    $Source = Under-Root $Plan.stage $Entry.source
    $Target = Under-Root $Plan.root $Entry.path
    if ([IO.Directory]::Exists($Target) -or ![IO.File]::Exists($Source)) { throw 'Invalid update file' }
    if ((Get-Item -LiteralPath $Source).Length -ne $Entry.size -or (Get-Sha256 $Source) -ne $Entry.sha256) { throw 'Staged update hash mismatch' }
  }
  if (!$Seen.ContainsKey($ExecutableName.ToLowerInvariant())) { throw 'Missing update executable' }
  foreach ($Entry in $Plan.obsolete) {
    if (!(Is-Managed $Entry.path)) { throw 'Unmanaged obsolete file' }
    $null = Under-Root $Plan.root $Entry.path
  }
  $Backup = [IO.Path]::Combine($Plan.root, '.lx-m-update-backup-' + $Plan.nonce)
  if ([IO.Directory]::Exists($Backup) -or [IO.File]::Exists($Backup)) { throw 'Backup already exists' }
  Write-Json ($PlanFile + '.ready') @{ nonce = $Plan.nonce }
  $Deadline = [DateTime]::UtcNow.AddSeconds(120)
  while (Get-Process -Id ([int]$Plan.oldPid) -ErrorAction SilentlyContinue) {
    Assert-NotCancelled
    if ([DateTime]::UtcNow -gt $Deadline) { throw 'Old application did not exit' }
    Start-Sleep -Milliseconds 100
  }
  Assert-NotCancelled
  [IO.Directory]::CreateDirectory($Backup) | Out-Null
  foreach ($Entry in $Plan.files) {
    $Target = Under-Root $Plan.root $Entry.path
    $Source = Under-Root $Plan.stage $Entry.source
    $Saved = Under-Root $Backup $Entry.path
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Target)) | Out-Null
    $HadOld = [IO.File]::Exists($Target)
    if ($HadOld) {
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Saved)) | Out-Null
      $MoveDeadline = [DateTime]::UtcNow.AddSeconds(30)
      while ($true) {
        try { [IO.File]::Move($Target, $Saved); break }
        catch { if ([DateTime]::UtcNow -gt $MoveDeadline) { throw }; Start-Sleep -Milliseconds 100 }
      }
    }
    $null = $Changed.Add(@{ target = $Target; saved = $Saved; hadOld = $HadOld })
    [IO.File]::Copy($Source, $Target, $false)
    if ((Get-Sha256 $Target) -ne $Entry.sha256) { throw 'Replacement hash mismatch' }
  }
  foreach ($Entry in $Plan.obsolete) {
    $Target = Under-Root $Plan.root $Entry.path
    if ([IO.File]::Exists($Target) -and (Get-Sha256 $Target) -eq $Entry.sha256) {
      $Saved = Under-Root $Backup $Entry.path
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Saved)) | Out-Null
      [IO.File]::Move($Target, $Saved)
      $null = $Changed.Add(@{ target = $Target; saved = $Saved; hadOld = $true })
    }
  }
  $NewProcess = Start-App $true
  $ConfirmationDeadline = [DateTime]::UtcNow.AddMilliseconds([int]$Plan.confirmationTimeoutMs)
  while (![IO.File]::Exists($PlanFile + '.ack')) {
    if ($NewProcess.HasExited) { throw 'New application exited before startup confirmation' }
    if ([DateTime]::UtcNow -gt $ConfirmationDeadline) {
      # Keep the backup when the new process is alive but slow to confirm.
      # Never overwrite files belonging to that running application.
      Write-Json ($PlanFile + '.result') @{ status = 'pending'; backup = $Backup }
      exit 0
    }
    Start-Sleep -Milliseconds 100
  }
  $Ack = Read-Json ($PlanFile + '.ack')
  if ($Ack.nonce -ne $Plan.nonce -or $Ack.version -ne $Plan.version) { throw 'Invalid startup confirmation' }
  $Committed = $true
  Write-Json ($PlanFile + '.result') @{ status = 'complete'; version = $Plan.version }
  # Both recursive targets have fixed identities and were checked under their
  # intended roots before removal. Extra application/user files are untouched.
  try {
    if ([IO.Path]::GetFullPath([IO.Path]::GetDirectoryName($Backup)) -ne [IO.Path]::GetFullPath($Plan.root)) { throw 'Invalid cleanup directory' }
    Assert-NoLinks $Backup
    Assert-NoLinks $Plan.stage
    Remove-Item -LiteralPath $Backup -Recurse -Force
    Remove-Item -LiteralPath $Plan.stage -Recurse -Force
  } catch {
    Write-Json ($PlanFile + '.result') @{ status = 'complete'; version = $Plan.version; cleanup = $_.Exception.Message }
  }
} catch {
  $Failure = $_.Exception.Message
  if (!$Committed) {
    if ($NewProcess -and !$NewProcess.HasExited) {
      Write-Json ($PlanFile + '.result') @{ status = 'pending'; backup = $Backup; message = $Failure }
      exit 0
    }
    for ($Index = $Changed.Count - 1; $Index -ge 0; $Index--) {
      $Change = $Changed[$Index]
      try {
        if ([IO.File]::Exists($Change.target)) { [IO.File]::Delete($Change.target) }
        if ($Change.hadOld -and [IO.File]::Exists($Change.saved)) { [IO.File]::Move($Change.saved, $Change.target) }
      } catch { $Failure = $Failure + '; rollback: ' + $_.Exception.Message }
    }
    if ($Changed.Count -gt 0 -and [IO.File]::Exists($Plan.executable)) { try { $null = Start-App $false } catch {} }
  }
  Write-Json ($PlanFile + '.result') @{ status = 'error'; message = $Failure }
  exit 1
}
`

// A detached GUI host lets PowerShell create its hidden console and avoids
// libuv's parent-job cleanup killing the updater when Electron exits.
export const UPDATE_RELAUNCH_BOOTSTRAP = String.raw`var args = WScript.Arguments;
if (args.length !== 3) WScript.Quit(1);
function quote(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
var command = quote(args(0)) + ' -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + quote(args(1)) + ' -PlanFile ' + quote(args(2));
var code = new ActiveXObject('WScript.Shell').Run(command, 0, true);
WScript.Quit(code);
`
