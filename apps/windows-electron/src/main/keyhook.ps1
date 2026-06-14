param([string]$Vks = "", [int]$PollMs = 15)

# Low-level global key-state watcher for ColdVoice.
# Electron's globalShortcut only fires on key-DOWN, so true hold-to-dictate
# (start on press, stop on release) is impossible with it. This polls the
# physical async state of the chord's virtual-key codes and prints "DOWN"/"UP"
# transitions to stdout, which the main process reads. No key is swallowed.

$codes = @()
foreach ($p in $Vks.Split(',')) { if ($p.Trim() -ne '') { $codes += [int]$p } }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CVKey {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
}
"@

$was = $false
while ($true) {
  $all = $codes.Count -gt 0
  foreach ($c in $codes) {
    if (([CVKey]::GetAsyncKeyState($c) -band 0x8000) -eq 0) { $all = $false; break }
  }
  if ($all -ne $was) {
    if ($all) { [Console]::Out.WriteLine("DOWN") } else { [Console]::Out.WriteLine("UP") }
    [Console]::Out.Flush()
    $was = $all
  }
  Start-Sleep -Milliseconds $PollMs
}
