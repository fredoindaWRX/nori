$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
# Nori computer control worker. JSON in on stdin, JSON out on stdout. The bridge never passes shell text here.
# 2026-11-14 (Wil: "use the apps like you would ... in her own tabs"): adds a background screenshot of the
# approved window (PrintWindow, no focus change), UI Automation toggle/expand/select, and pointer/keyboard input
# posted to the window itself so Wil's real mouse and keyboard are not moved. Only `foreground` key/click input
# takes focus, and the session asks Wil before that.
$NativeSource = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class NoriWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO { public int cbSize, flags; public IntPtr hwndActive, hwndFocus, hwndCapture, hwndMenuOwner, hwndMoveSize, hwndCaret; public RECT rcCaret; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr ChildWindowFromPointEx(IntPtr parent, POINT p, uint flags);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern short VkKeyScan(char c);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);

  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static string Windows(uint pid) {
    var sb = new StringBuilder("[");
    EnumWindows((h, l) => {
      if (Pid(h) == pid && IsWindowVisible(h)) {
        var t = new StringBuilder(256); GetWindowText(h, t, 256); RECT r; GetWindowRect(h, out r);
        if (r.Right - r.Left > 40 && r.Bottom - r.Top > 40) {
          if (sb.Length > 1) sb.Append(',');
          sb.Append("{\"windowHandle\":" + h.ToInt64() + ",\"processId\":" + pid + ",\"title\":\"" + Esc(t.ToString()) + "\",\"width\":" + (r.Right - r.Left) + ",\"height\":" + (r.Bottom - r.Top) + "}");
        }
      }
      return true;
    }, IntPtr.Zero);
    return sb.Append(']').ToString();
  }
  static string Esc(string s) { var b = new StringBuilder(); foreach (char c in s) { if (c == '"' || c == '\\') b.Append('\\').Append(c); else if (c < 32) b.Append(' '); else b.Append(c); } return b.ToString(); }

  // Screenshot of one window only, without bringing it forward. JPEG, shrunk until its base64 form fits
  // maxChars: Nori's router counts request bytes against the model context, so big images are refused.
  public static string Capture(IntPtr h, int maxWidth, int maxChars, out int width, out int height, out double scale) {
    if (IsIconic(h)) { ShowWindow(h, 4); System.Threading.Thread.Sleep(250); }
    RECT r; GetWindowRect(h, out r); width = r.Right - r.Left; height = r.Bottom - r.Top;
    if (width < 1 || height < 1) throw new Exception("Window has no visible area");
    var jpeg = Array.Find(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
    using (var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
      using (var g = Graphics.FromImage(bmp)) { IntPtr dc = g.GetHdc(); try { if (!PrintWindow(h, dc, 2)) PrintWindow(h, dc, 0); } finally { g.ReleaseHdc(dc); } }
      int target = Math.Min(maxWidth, width); long quality = 60; string data = null;
      for (int attempt = 0; attempt < 8; attempt++) {
        scale = (double)target / width;
        int w = target, hh = Math.Max(1, (int)Math.Round(height * scale));
        using (var outBmp = new Bitmap(w, hh)) {
          using (var g2 = Graphics.FromImage(outBmp)) { g2.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic; g2.DrawImage(bmp, 0, 0, w, hh); }
          var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
          using (var ms = new System.IO.MemoryStream()) { outBmp.Save(ms, jpeg, ps); data = Convert.ToBase64String(ms.ToArray()); }
        }
        if (data.Length <= maxChars) return data;
        if (quality > 40) quality -= 10; else target = (int)(target * 0.85);
      }
      throw new Exception("Window image could not be made small enough");
    }
  }

  // Window-relative point (0,0 = window's top-left corner) to the deepest child and its client coordinates.
  static IntPtr Target(IntPtr top, int x, int y, out IntPtr lp) {
    RECT r; GetWindowRect(top, out r);
    var screen = new POINT { X = r.Left + x, Y = r.Top + y };
    IntPtr target = top;
    for (int i = 0; i < 16; i++) {
      var local = screen; ScreenToClient(target, ref local);
      IntPtr child = ChildWindowFromPointEx(target, local, 0x0001 | 0x0004);
      if (child == IntPtr.Zero || child == target) break;
      target = child;
    }
    var c = screen; ScreenToClient(target, ref c);
    lp = (IntPtr)((c.Y << 16) | (c.X & 0xFFFF));
    return target;
  }
  public static void Click(IntPtr top, int x, int y, string button, bool dbl) {
    IntPtr lp; IntPtr t = Target(top, x, y, out lp);
    uint down = 0x0201, up = 0x0202, dblMsg = 0x0203; IntPtr flag = (IntPtr)0x0001;
    if (button == "right") { down = 0x0204; up = 0x0205; dblMsg = 0x0206; flag = (IntPtr)0x0002; }
    PostMessage(t, 0x0200, IntPtr.Zero, lp);
    PostMessage(t, down, flag, lp); PostMessage(t, up, IntPtr.Zero, lp);
    if (dbl) { PostMessage(t, dblMsg, flag, lp); PostMessage(t, up, IntPtr.Zero, lp); }
  }
  public static void Drag(IntPtr top, int x1, int y1, int x2, int y2) {
    IntPtr lp; IntPtr t = Target(top, x1, y1, out lp);
    PostMessage(t, 0x0201, (IntPtr)1, lp);
    for (int i = 1; i <= 12; i++) {
      int x = x1 + (x2 - x1) * i / 12, y = y1 + (y2 - y1) * i / 12; IntPtr lpi;
      RECT r; GetWindowRect(top, out r); var s = new POINT { X = r.Left + x, Y = r.Top + y }; ScreenToClient(t, ref s);
      lpi = (IntPtr)((s.Y << 16) | (s.X & 0xFFFF)); PostMessage(t, 0x0200, (IntPtr)1, lpi); System.Threading.Thread.Sleep(15);
    }
    RECT r2; GetWindowRect(top, out r2); var e = new POINT { X = r2.Left + x2, Y = r2.Top + y2 }; ScreenToClient(t, ref e);
    PostMessage(t, 0x0202, IntPtr.Zero, (IntPtr)((e.Y << 16) | (e.X & 0xFFFF)));
  }
  public static void Scroll(IntPtr top, int x, int y, int notches) {
    IntPtr lp; IntPtr t = Target(top, x, y, out lp);
    RECT r; GetWindowRect(top, out r);
    IntPtr screenLp = (IntPtr)(((r.Top + y) << 16) | ((r.Left + x) & 0xFFFF));
    PostMessage(t, 0x020A, (IntPtr)((notches * 120) << 16), screenLp);
  }
  static IntPtr Focus(IntPtr top) {
    uint pid; uint thread = GetWindowThreadProcessId(top, out pid);
    var info = new GUITHREADINFO(); info.cbSize = Marshal.SizeOf(info);
    if (GetGUIThreadInfo(thread, ref info) && info.hwndFocus != IntPtr.Zero) return info.hwndFocus;
    return top;
  }
  public static void TypeText(IntPtr top, string text) {
    IntPtr t = Focus(top);
    foreach (char c in text) { if (c == '\n') { PostMessage(t, 0x0100, (IntPtr)0x0D, IntPtr.Zero); PostMessage(t, 0x0101, (IntPtr)0x0D, IntPtr.Zero); } else PostMessage(t, 0x0102, (IntPtr)c, IntPtr.Zero); }
  }
  // Background keys: plain keys are posted to the focused control. Modifier combos need real key state,
  // so they only work with foreground=true (focus moves to the window; the session asks first).
  public static void Keys(IntPtr top, byte[] mods, byte key, bool foreground) {
    if (foreground) {
      SetForegroundWindow(top); System.Threading.Thread.Sleep(120);
      foreach (var m in mods) keybd_event(m, 0, 0, UIntPtr.Zero);
      keybd_event(key, 0, 0, UIntPtr.Zero); keybd_event(key, 0, 2, UIntPtr.Zero);
      for (int i = mods.Length - 1; i >= 0; i--) keybd_event(mods[i], 0, 2, UIntPtr.Zero);
      return;
    }
    IntPtr t = Focus(top); uint scan = MapVirtualKey(key, 0);
    PostMessage(t, 0x0100, (IntPtr)key, (IntPtr)(1 | (scan << 16)));
    PostMessage(t, 0x0101, (IntPtr)key, (IntPtr)(1 | (scan << 16) | (3u << 30)));
  }
}
'@

function Write-Json($value) { $value | ConvertTo-Json -Depth 6 -Compress }
function Get-Root($request) {
  $handle = [IntPtr][long]$request.windowHandle
  if (-not [NoriWin]::IsWindow($handle)) { throw 'Target window is gone' }
  if ([NoriWin]::Pid($handle) -ne [uint32]$request.processId) { throw 'Target window changed' }
  return $handle
}
function Resolve-Key([string]$name) {
  $named = @{ enter=0x0D; return=0x0D; tab=0x09; escape=0x1B; esc=0x1B; space=0x20; backspace=0x08; delete=0x2E; del=0x2E;
    insert=0x2D; home=0x24; end=0x23; pageup=0x21; pagedown=0x22; up=0x26; down=0x28; left=0x25; right=0x27 }
  $n = $name.ToLowerInvariant()
  if ($named.ContainsKey($n)) { return [byte]$named[$n] }
  if ($n -match '^f([1-9]|1[0-2])$') { return [byte](0x6F + [int]$Matches[1]) }
  if ($n.Length -eq 1) { $v = [NoriWin]::VkKeyScan([char]$n); if ($v -ne -1) { return [byte]($v -band 0xFF) } }
  throw "Unknown key: $name"
}

try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.operation -eq 'list_windows') {
    $windows = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.ProcessName -ne 'Nori' } |
      Select-Object -First 100 @{n='windowHandle';e={$_.MainWindowHandle.ToInt64()}},@{n='processId';e={$_.Id}},@{n='title';e={$_.MainWindowTitle.Substring(0,[Math]::Min(200,$_.MainWindowTitle.Length))}},@{n='path';e={try{$_.Path}catch{''}}})
    Write-Json @{windows=$windows}
    exit 0
  }
  $uia = @('inspect','invoke','set_text','toggle','expand','collapse','select')
  $native = @('process_windows','capture','click','double_click','right_click','scroll','drag','type_text','key')
  if ($request.operation -notin ($uia + $native)) { throw 'Unsupported operation' }
  if ([long]$request.windowHandle -le 0 -or [int]$request.processId -le 0) { throw 'Invalid window binding' }
  Add-Type -TypeDefinition $NativeSource -ReferencedAssemblies System.Drawing
  if ($request.operation -eq 'process_windows') {
    [Console]::Out.Write('{"windows":' + [NoriWin]::Windows([uint32]$request.processId) + '}')
    exit 0
  }
  $handle = Get-Root $request
  if ($request.operation -in $native) {
    $x = [int]$request.x; $y = [int]$request.y
    switch ($request.operation) {
      'capture' {
        $w = 0; $h = 0; $scale = 1.0
        $max = if ($request.maxWidth) { [Math]::Min(1600, [Math]::Max(320, [int]$request.maxWidth)) } else { 1024 }
        $chars = if ($request.maxChars) { [Math]::Min(4000000, [Math]::Max(20000, [int]$request.maxChars)) } else { 100000 }
        $jpg = [NoriWin]::Capture($handle, $max, $chars, [ref]$w, [ref]$h, [ref]$scale)
        Write-Json @{ mimeType='image/jpeg'; data=$jpg; windowWidth=$w; windowHeight=$h; scale=$scale }
        exit 0
      }
      'click' { [NoriWin]::Click($handle, $x, $y, 'left', $false) }
      'double_click' { [NoriWin]::Click($handle, $x, $y, 'left', $true) }
      'right_click' { [NoriWin]::Click($handle, $x, $y, 'right', $false) }
      'scroll' { [NoriWin]::Scroll($handle, $x, $y, [Math]::Max(-20, [Math]::Min(20, [int]$request.notches))) }
      'drag' { [NoriWin]::Drag($handle, $x, $y, [int]$request.x2, [int]$request.y2) }
      'type_text' {
        $text = [string]$request.text
        if ($text.Length -gt 4000 -or $text.Contains([char]0)) { throw 'Invalid text' }
        [NoriWin]::TypeText($handle, $text)
      }
      'key' {
        $parts = ([string]$request.keys).ToLowerInvariant().Split('+') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        if (-not $parts -or $parts.Count -gt 4) { throw 'Invalid key combination' }
        $mods = [Collections.Generic.List[byte]]::new()
        foreach ($m in @($parts | Select-Object -SkipLast 1)) {
          switch ($m) { 'ctrl' { $mods.Add(0x11) } 'control' { $mods.Add(0x11) } 'shift' { $mods.Add(0x10) } 'alt' { $mods.Add(0x12) } default { throw "Unknown modifier: $m" } }
        }
        if ($mods.Count -gt 0 -and -not $request.foreground) { throw 'Shortcut keys with Ctrl, Shift or Alt need foreground input' }
        [NoriWin]::Keys($handle, $mods.ToArray(), (Resolve-Key $parts[-1]), [bool]$request.foreground)
      }
    }
    Write-Json @{completed=$true}
    exit 0
  }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if ($null -eq $root -or $root.Current.ProcessId -ne [int]$request.processId) { throw 'Target window changed' }
  $windowRect = $root.Current.BoundingRectangle
  $controls = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $elements = [Collections.Generic.List[object]]::new()
  $selected = $null
  foreach ($control in $controls) {
    if ($control.Current.ProcessId -ne [int]$request.processId -or $control.Current.IsPassword -or $control.Current.IsOffscreen) { continue }
    $runtimeId = ($control.GetRuntimeId() -join '.')
    if ($request.operation -ne 'inspect') {
      if ($runtimeId -eq [string]$request.elementId) { $selected = $control; break }
      continue
    }
    $p = $null
    $canInvoke = $control.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$p)
    $vp = $null
    $canSetText = $control.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$vp)
    if ($canSetText -and $vp.Current.IsReadOnly) { $canSetText = $false }
    $canToggle = $control.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$p)
    $canExpand = $control.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$p)
    $canSelect = $control.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$p)
    $label = [string]$control.Current.Name
    if ($label.Length -gt 1000) { $label = $label.Substring(0,1000) }
    $b = $control.Current.BoundingRectangle
    $rect = if ($b.IsEmpty -or [double]::IsInfinity($b.Width)) { $null } else { @([int]($b.X - $windowRect.X), [int]($b.Y - $windowRect.Y), [int]$b.Width, [int]$b.Height) }
    $elements.Add(@{ id=$runtimeId; name=$label; controlType=$control.Current.ControlType.ProgrammaticName; password=$false;
      canInvoke=[bool]$canInvoke; canSetText=[bool]$canSetText; canToggle=[bool]$canToggle; canExpand=[bool]$canExpand; canSelect=[bool]$canSelect; rect=$rect })
    if ($elements.Count -ge 200) { break }
  }
  if ($request.operation -eq 'inspect') {
    Write-Json @{elements=@($elements.ToArray())}
    exit 0
  }
  if ($null -eq $selected -or -not $selected.Current.IsEnabled -or $selected.Current.IsPassword) { throw 'Control is unavailable' }
  if ($selected.Current.Name -ne [string]$request.expectedName -or $selected.Current.ControlType.ProgrammaticName -ne [string]$request.expectedControlType) { throw 'Control changed after observation' }
  switch ($request.operation) {
    'invoke' { $selected.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
    'toggle' { $selected.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle() }
    'expand' { $selected.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
    'collapse' { $selected.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Collapse() }
    'select' { $selected.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() }
    'set_text' {
      $text = [string]$request.text
      if ($text.Length -gt 4000 -or $text.Contains([char]0)) { throw 'Invalid text' }
      $pattern = $selected.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($pattern.Current.IsReadOnly) { throw 'Control is read-only' }
      $pattern.SetValue($text)
      if ($pattern.Current.Value -ne $text) { throw 'Text readback did not match' }
    }
  }
  Write-Json @{completed=$true}
} catch {
  [Console]::Error.WriteLine('Windows computer action failed: ' + $_.Exception.Message)
  exit 1
}
