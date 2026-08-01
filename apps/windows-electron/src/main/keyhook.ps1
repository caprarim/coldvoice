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

# Every virtual-key code keyhook.js's tokenToVk() can produce, so a chord match
# can require an EXACT key set, not just "these keys happen to be down". Without
# this, "Ctrl+1" also fired on "Ctrl+Shift+1" (extra Shift ignored) and on
# "Ctrl+2" (rollover/ghosting reporting an extra key down alongside the real one).
$monitored = New-Object System.Collections.Generic.List[int]
foreach ($v in 0x11,0x12,0x10,0x14,0x20,0x0d,0x09,0x1b) { $monitored.Add($v) }
for ($i = 0x30; $i -le 0x39; $i++) { $monitored.Add($i) }
for ($i = 0x41; $i -le 0x5A; $i++) { $monitored.Add($i) }
for ($i = 0x70; $i -le 0x87; $i++) { $monitored.Add($i) }

while ($true) {
  $down = New-Object System.Collections.Generic.HashSet[int]
  foreach ($m in $monitored) {
    if (([CVKey]::GetAsyncKeyState($m) -band 0x8000) -ne 0) { [void]$down.Add($m) }
  }
  foreach ($d in $defs) {
    $match = $down.Count -eq $d.Codes.Count
    if ($match) {
      foreach ($c in $d.Codes) {
        if (-not $down.Contains($c)) { $match = $false; break }
      }
    }
    if ($match -ne $d.Was) {
      if ($match) { [Console]::Out.WriteLine("DOWN:" + $d.Id) } else { [Console]::Out.WriteLine("UP:" + $d.Id) }
      [Console]::Out.Flush()
      $d.Was = $match
    }
  }
  Start-Sleep -Milliseconds $PollMs
}
