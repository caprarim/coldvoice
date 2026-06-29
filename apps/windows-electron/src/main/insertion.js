'use strict';

// Windows text insertion + focus detection.
// Focus/password detection uses UI Automation via PowerShell (no native build).
// Insertion uses clipboard-preserving paste: save clipboard -> set text -> paste
// -> restore clipboard. Password fields are never written to. Terminals
// (PowerShell / cmd / Windows Terminal) get a console-safe Shift+Insert paste.
// When the focus is NOT an editable target, the text is left on the clipboard
// instead of pasted, so the user can paste it wherever they like.

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
// shared input-detection rules understand, plus a bounding rectangle and the
// element class name (used to recognise console windows).
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
  $cls = $el.Current.ClassName
  $proc = (Get-Process -Id $el.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName
  $o = [ordered]@{
    controlType = ($ct -replace 'ControlType.','')
    isPassword = [bool]$isPwd
    supportsValuePattern = ($vp -gt 0)
    supportsTextPattern = ($tp -gt 0)
    appId = $proc
    className = $cls
    name = $name
    x = [int]$r.X; y = [int]$r.Y; width = [int]$r.Width; height = [int]$r.Height
  }
  $o | ConvertTo-Json -Compress
} catch { '{}' }
`;

const CONSOLE_APPS = new Set(['windowsterminal', 'cmd', 'powershell', 'pwsh', 'conhost', 'wt']);

function isConsoleTarget(node) {
  if (!node) return false;
  const cls = String(node.className || '').toLowerCase();
  if (cls.includes('console') || cls.includes('terminal')) return true;
  const app = String(node.appId || '').toLowerCase();
  return CONSOLE_APPS.has(app);
}

async function getFocusedTarget() {
  try {
    const out = await runPowerShell(FOCUS_SCRIPT);
    const node = JSON.parse(out || '{}');
    node.isConsole = isConsoleTarget(node);
    // Consoles always accept pasted text even when UI Automation is vague.
    node.canInsert = node.isConsole || canInsertInto(node);
    return node;
  } catch {
    return { canInsert: false };
  }
}

// Clipboard-preserving paste. Consoles get Shift+Insert (universally accepted by
// conhost and Windows Terminal); everything else gets Ctrl+V.
async function pasteText(text, isConsole) {
  const prevText = clipboard.readText();
  const prevHtml = clipboard.readHTML();
  clipboard.writeText(text);
  const combo = isConsole ? '+{INS}' : '^v';
  const preDelay = isConsole ? 80 : 40;
  const postDelay = isConsole ? 120 : 80;
  await runPowerShell(
    'Add-Type -AssemblyName System.Windows.Forms; ' +
      `Start-Sleep -Milliseconds ${preDelay}; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('${combo}'); ` +
      `Start-Sleep -Milliseconds ${postDelay}`
  );
  // Restore the previous clipboard.
  if (prevHtml) clipboard.write({ text: prevText, html: prevHtml });
  else clipboard.writeText(prevText);
}

// Fire a paste into whatever currently has focus, using text already on the
// clipboard. Consoles get Shift+Insert; everything else Ctrl+V. Used by the
// click-to-paste fallback (middle-click anywhere, left-click in a terminal).
async function pasteFromClipboard(isConsole) {
  const combo = isConsole ? '+{INS}' : '^v';
  await runPowerShell(
    'Add-Type -AssemblyName System.Windows.Forms; ' +
      'Start-Sleep -Milliseconds 25; ' +
      `[System.Windows.Forms.SendKeys]::SendWait('${combo}'); ` +
      'Start-Sleep -Milliseconds 40'
  );
}

// Insert text into the focused target.
//   - password field        -> refuse        ({ ok:false, reason:'password' })
//   - editable field/console -> paste         ({ ok:true,  mode:'paste' })
//   - anything else          -> clipboard only ({ ok:true,  mode:'clipboard' })
// When `preTarget` is supplied, skip the expensive getFocusedTarget() call —
// the caller already knows what window was focused before dictation started.
async function insertText(text, preTarget) {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  const target = preTarget || await getFocusedTarget();
  if (target && target.isPassword === true) {
    return { ok: false, reason: 'password', target };
  }
  if (!target || !target.canInsert) {
    clipboard.writeText(text);
    return { ok: true, mode: 'clipboard', target };
  }
  await pasteText(text, target.isConsole);
  return { ok: true, mode: 'paste', target };
}

module.exports = { getFocusedTarget, insertText, pasteText, pasteFromClipboard };
