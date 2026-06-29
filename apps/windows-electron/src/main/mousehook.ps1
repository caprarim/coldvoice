param([int]$PollMs = 15)

# Global mouse-button watcher for ColdVoice's click-to-paste fallback. Polls the
# async state of the left and middle buttons and, on each DOWN edge, prints the
# button plus the foreground window's class name so the main process can decide
# whether to paste the last transcript (middle = anywhere, left = terminals).
#
# Output lines: "L:<className>" / "M:<className>". No click is swallowed.

Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class CVMouse {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static string ForeProcessName() {
    try {
      IntPtr h = GetForegroundWindow();
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == 0) return "";
      return Process.GetProcessById((int)pid).ProcessName;
    } catch { return ""; }
  }
}
"@

function ForeInfo {
  $h = [CVMouse]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 256
  [void][CVMouse]::GetClassName($h, $sb, 256)
  $cls = $sb.ToString()
  $proc = [CVMouse]::ForeProcessName()
  return "$cls|$proc"
}

$lWas = $false
$mWas = $false

while ($true) {
  $l = ([CVMouse]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
  $m = ([CVMouse]::GetAsyncKeyState(0x04) -band 0x8000) -ne 0
  if ($l -and -not $lWas) { [Console]::Out.WriteLine("L:" + (ForeInfo)); [Console]::Out.Flush() }
  if ($m -and -not $mWas) { [Console]::Out.WriteLine("M:" + (ForeInfo)); [Console]::Out.Flush() }
  $lWas = $l
  $mWas = $m
  Start-Sleep -Milliseconds $PollMs
}
