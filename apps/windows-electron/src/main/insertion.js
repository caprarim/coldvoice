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
// element class name (used to recognise console windows). The foreground
// window (class + process) is captured independently of the focused element:
// UI Automation is flaky for terminals (Windows Terminal in particular), and
// the foreground window keeps console detection working when it fails.
const FOCUS_SCRIPT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$q = [char]34
$u = $q + 'user32.dll' + $q
$sig = '[DllImport(' + $u + ')] public static extern IntPtr GetForegroundWindow(); [DllImport(' + $u + ', CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount); [DllImport(' + $u + ')] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);'
$o = [ordered]@{}
try {
  Add-Type -MemberDefinition $sig -Name Win32 -Namespace CV
  $h = [CV.Win32]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][CV.Win32]::GetClassName($h, $sb, 256)
    $o.fgClassName = $sb.ToString()
    $procId = [uint32]0
    [void][CV.Win32]::GetWindowThreadProcessId($h, [ref]$procId)
    $o.fgApp = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  }
} catch {}
try {
  $el = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -ne $el) {
    $c = $el.Current
    $o.controlType = ($c.ControlType.ProgrammaticName -replace 'ControlType.','')
    $o.isPassword = [bool]$c.IsPassword
    $vp = $el.GetSupportedPatterns() | Where-Object { $_.ProgrammaticName -like '*ValuePattern*' } | Measure-Object | Select-Object -ExpandProperty Count
    $tp = $el.GetSupportedPatterns() | Where-Object { $_.ProgrammaticName -like '*TextPattern*' } | Measure-Object | Select-Object -ExpandProperty Count
    $o.supportsValuePattern = ($vp -gt 0)
    $o.supportsTextPattern = ($tp -gt 0)
    $o.appId = (Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue).ProcessName
    $o.className = $c.ClassName
    $o.name = $c.Name
    if (-not $c.IsPassword) {
      $ctx = ''
      try {
        $vpat = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $ctx = [string]$vpat.Current.Value
      } catch {
        try {
          $tpat = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
          $ctx = [string]$tpat.DocumentRange.GetText(2000)
        } catch {}
      }
      if ($ctx.Length -gt 1200) { $ctx = $ctx.Substring($ctx.Length - 1200) }
      if ($ctx) { $o.textContext = $ctx }
    }
    try {
      $r = $c.BoundingRectangle
      $o.x = [int]$r.X; $o.y = [int]$r.Y; $o.width = [int]$r.Width; $o.height = [int]$r.Height
    } catch {}
  }
} catch {}
$o | ConvertTo-Json -Compress
`;

const CONSOLE_APPS = new Set([
  'windowsterminal', 'cmd', 'powershell', 'pwsh', 'conhost', 'openconsole', 'wt',
  'hyper', 'alacritty', 'wezterm-gui', 'wezterm', 'fluentterminal', 'terminus', 'tabby',
  'mintty',
]);

// Console detection by window class or process name. 'cascadia' covers Windows
// Terminal's CASCADIA_HOSTING_WINDOW_CLASS (its UIA elements often expose no
// 'terminal'/'console' hint at all).
function isConsoleName(className, appName) {
  const cls = String(className || '').toLowerCase();
  if (
    cls.includes('console')
    || cls.includes('terminal')
    || cls.includes('cascadia')
    || cls.includes('mintty')
    || cls.includes('xterm')
  ) return true;
  const proc = String(appName || '').trim().toLowerCase().replace(/\.exe$/, '');
  return CONSOLE_APPS.has(proc);
}

function isConsoleTarget(node) {
  if (!node) return false;
  return isConsoleName(node.className, node.appId) || isConsoleName(node.fgClassName, node.fgApp);
}

// Chromium/Electron apps (Agent Launcher, browsers, VS Code, …) often expose
// the focused element to UI Automation as a bare "Chrome_*" pane with no
// value/text patterns even while a real text box has focus — the a11y tree
// only materializes lazily. Such an element must NOT count as a trustworthy
// "known non-editable" target, or dictations land on the clipboard instead of
// pasting. Ctrl+V is a harmless no-op if nothing editable is focused.
function isChromiumShell(node) {
  if (!node) return false;
  const re = /^chrome_/i;
  return re.test(String(node.className || '')) || re.test(String(node.fgClassName || ''));
}

async function getFocusedTarget() {
  try {
    const out = await runPowerShell(FOCUS_SCRIPT);
    const node = JSON.parse(out || '{}');
    if (!node.appId && node.fgApp) node.appId = node.fgApp;
    node.isConsole = isConsoleTarget(node);
    // `known` = UI Automation actually resolved a focused element. Only a known
    // element may downgrade insertion to clipboard-only; a failed/vague query
    // must not (that was why terminal dictations landed on the clipboard).
    node.known = !!(node.controlType || node.className);
    node.chromiumShell = isChromiumShell(node);
    // Consoles always accept pasted text even when UI Automation is vague.
    node.canInsert = node.isConsole || canInsertInto(node);
    return node;
  } catch {
    return { canInsert: false, known: false };
  }
}

const CONSOLE_RESTORE_MS = 700;

function restoreClipboard(prevText, prevHtml) {
  if (prevHtml) clipboard.write({ text: prevText, html: prevHtml });
  else clipboard.writeText(prevText);
}

// Clipboard-preserving paste. Consoles get Shift+Insert (universally accepted by
// conhost and Windows Terminal); everything else gets Ctrl+V.
async function pasteText(text, isConsole) {
  const prevText = clipboard.readText();
  const prevHtml = clipboard.readHTML();
  clipboard.writeText(text);
  const combo = isConsole ? '+{INS}' : '^v';
  const preDelay = isConsole ? 120 : 40;
  const postDelay = isConsole ? 350 : 120;
  await runPowerShell(
    'Add-Type -AssemblyName System.Windows.Forms; ' +
      `Start-Sleep -Milliseconds ${preDelay}; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('${combo}'); ` +
      `Start-Sleep -Milliseconds ${postDelay}`
  );
  // Restore the previous clipboard. Consoles read the clipboard asynchronously
  // after Shift+Insert, so an immediate restore raced the paste and made it
  // drop — they get a deferred restore instead, skipped if anything else has
  // taken the clipboard in the meantime.
  if (isConsole) {
    setTimeout(() => {
      if (clipboard.readText() !== text) return;
      restoreClipboard(prevText, prevHtml);
    }, CONSOLE_RESTORE_MS);
    return;
  }
  restoreClipboard(prevText, prevHtml);
}

// Fire a paste into whatever currently has focus, using text already on the
// clipboard. Consoles get Shift+Insert; everything else Ctrl+V. Used by the
// click-to-paste fallback (middle-click anywhere, left-click in a terminal).
async function pasteFromClipboard(isConsole) {
  const combo = isConsole ? '+{INS}' : '^v';
  // Consoles need a longer settle: conhost / Windows Terminal often ignore a
  // paste that fires in the same tick as the mouse-up that focused them.
  const preDelay = isConsole ? 100 : 30;
  const postDelay = isConsole ? 280 : 50;
  await runPowerShell(
    'Add-Type -AssemblyName System.Windows.Forms; ' +
      `Start-Sleep -Milliseconds ${preDelay}; ` +
      `[System.Windows.Forms.SendKeys]::SendWait('${combo}'); ` +
      `Start-Sleep -Milliseconds ${postDelay}`
  );
}

// Insert text into the focused target.
//   - password field                          -> refuse   ({ ok:false, reason:'password' })
//   - editable field / console / unknown      -> paste    ({ ok:true,  mode:'paste' })
//   - KNOWN non-editable element (desktop &c) -> clipboard ({ ok:true,  mode:'clipboard' })
// Paste is the default: only a positively-identified non-editable target (e.g.
// focus sitting on the desktop or a plain window, not an input) downgrades to
// clipboard-only. A failed or vague focus query must paste — Ctrl+V is a no-op
// on truly non-editable surfaces, whereas defaulting to clipboard silently
// dropped terminal dictations whenever UI Automation hiccupped.
// When `preTarget` is supplied, skip the expensive getFocusedTarget() call —
// the caller already knows what window was focused before dictation started.
async function insertText(text, preTarget) {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };
  const target = preTarget || await getFocusedTarget();
  if (target && target.isPassword === true) {
    return { ok: false, reason: 'password', target };
  }
  if (target && target.known && !target.canInsert && !isChromiumShell(target)) {
    clipboard.writeText(text);
    return { ok: true, mode: 'clipboard', target };
  }
  await pasteText(text, !!(target && target.isConsole));
  return { ok: true, mode: 'paste', target };
}

module.exports = { getFocusedTarget, insertText, pasteText, pasteFromClipboard };
