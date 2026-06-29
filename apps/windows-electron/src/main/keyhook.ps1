param([string]$Chords = "", [int]$PollMs = 12)

# Low-level global key-state watcher for ColdVoice.
# Electron's globalShortcut only fires on key-DOWN, so true hold-to-dictate
# (start on press, stop on release) is impossible with it. This polls the
# physical async state of one or more chords (each a set of virtual-key codes)
# and prints "DOWN:<id>" / "UP:<id>" transitions to stdout, which the main
# process reads. No key is swallowed.
#
# -Chords format: "id:vk,vk;id:vk,vk"  e.g. "toggle:17,49;hold:17,20"

$defs = @()
foreach ($chord in $Chords.Split(';')) {
  if ($chord.Trim() -eq '') { continue }
  $parts = $chord.Split(':')
  if ($parts.Count -lt 2) { continue }
  $id = $parts[0].Trim()
  $codes = @()
  foreach ($p in $parts[1].Split(',')) { if ($p.Trim() -ne '') { $codes += [int]$p } }
  if ($codes.Count -gt 0) {
    $defs += [pscustomobject]@{ Id = $id; Codes = $codes; Was = $false }
  }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CVKey {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
}
"@

while ($true) {
  foreach ($d in $defs) {
    $all = $true
    foreach ($c in $d.Codes) {
      if (([CVKey]::GetAsyncKeyState($c) -band 0x8000) -eq 0) { $all = $false; break }
    }
    if ($all -ne $d.Was) {
      if ($all) { [Console]::Out.WriteLine("DOWN:" + $d.Id) } else { [Console]::Out.WriteLine("UP:" + $d.Id) }
      [Console]::Out.Flush()
      $d.Was = $all
    }
  }
  Start-Sleep -Milliseconds $PollMs
}
