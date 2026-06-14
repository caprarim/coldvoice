'use strict';

// Windows text insertion + focus detection.
// Focus/password detection uses UI Automation via PowerShell (no native build).
// Insertion uses clipboard-preserving paste: save clipboard -> set text -> Ctrl+V
// -> restore clipboard. Password fields are never written to.

const { execFile } = require('child_process');
const { clipboard } = require('electron');
const { canInsertInto } = require('@coldvoice/input-detection');

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout.trim());
      }
    );
  });
}

// Query the currently focused UI Automation element. Returns a node object the
// shared input-detection rules understand, plus a bounding rectangle.
const FOCUS_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try {
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $el) { '{}'; return }
  $ct = $el.Current.ControlType.ProgrammaticName
  $isPwd = $el.Current.IsPassword
  $r = $el.Current.BoundingRectangle
  $vp = $el.GetSupportedPatterns() | Where-Object { $_.ProgrammaticName -like '*ValuePattern*' } | Measure-Object | Select-Object -ExpandProperty Count
  $tp = $el.GetSupportedPatterns() | Where-Object { $_.ProgrammaticName -like '*TextPattern*' } | Measure-Object | Select-Object -ExpandProperty Count
  $name = $el.Current.Name
  $proc = (Get-Process -Id $el.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName
  $o = [ordered]@{
    controlType = ($ct -replace 'ControlType.','')
    isPassword = [bool]$isPwd
    supportsValuePattern = ($vp -gt 0)
    supportsTextPattern = ($tp -gt 0)
    appId = $proc
    name = $name
    x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height
  }
  $o | ConvertTo-Json -Compress
} catch { '{}' }
`;

async function getFocusedTarget() {
  try {
    const out = await runPowerShell(FOCUS_SCRIPT);
    const node = JSON.parse(out || '{}');
    node.canInsert = canInsertInto(node);
    return node;
  } catch {
    return { canInsert: false };
  }
}

// Clipboard-preserving paste.
async function pasteText(text) {
  const prevText = clipboard.readText();
  const prevHtml = clipboard.readHTML();
  clipboard.writeText(text);
  // SendKeys with the literal text escaped is unreliable; use Ctrl+V paste.
  await runPowerShell(
    "Add-Type -AssemblyName System.Windows.Forms; " +
      "Start-Sleep -Milliseconds 30; " +
      "[System.Windows.Forms.SendKeys]::SendWait('^v'); " +
      "Start-Sleep -Milliseconds 60"
  );
  // Restore the previous clipboard.
  if (prevHtml) clipboard.write({ text: prevText, html: prevHtml });
  else clipboard.writeText(prevText);
}

// Insert text into whatever input currently has focus. To match the behaviour
// the user expects ("paste into whatever input I'm in", including terminals like
// the Claude Code CLI), we paste into the focused window regardless of whether
// UI Automation reports it as a classic edit control. The only hard refusal is a
// password field, where writing the clipboard would be unsafe.
async function insertText(text) {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  const target = await getFocusedTarget();
  if (target && target.isPassword === true) {
    return { ok: false, reason: 'password', target };
  }
  await pasteText(text);
  return { ok: true, target };
}

module.exports = { getFocusedTarget, insertText, pasteText };
