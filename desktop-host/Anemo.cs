// Anemo.cs — High-Performance Native Live-Wallpaper Host (WinForms + WebView2).
//
// Features:
//  * Attaches to Windows desktop via WorkerW / Progman child hierarchy.
//  * Hardware video acceleration (Direct3D11 / NVDEC / QSV) with transparent WebGL eye rig.
//  * Multi-monitor support: select screen or duplicate on all monitors (with audio isolation).
//  * Zero camera usage by default (Mouse tracking mode is default; camera only activates on Person/Gaze).
//  * Eyelid follow adjustment submenu (0% to 100%, 56% default).
//  * Run on Windows Startup toggle in tray menu.
//  * Ambient 1-hr loop BGM toggle.
//  * Sleep mode: 0 FPS, 0% CPU when screen is covered by fullscreen windows or locked.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace AnemoWallpaper
{
    // ------------------------------------------------------------------ Win32 Interop
    internal static class Native
    {
        public const int WM_ERASEBKGND = 0x0014;
        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint SWP_SHOWWINDOW = 0x0040;
        public const uint SWP_FRAMECHANGED = 0x0020;

        public const int GWL_STYLE = -16;
        public const int GWL_EXSTYLE = -20;
        public const int WS_CHILD = 0x40000000;
        public const int WS_POPUP = unchecked((int)0x80000000);
        public const int WS_VISIBLE = 0x10000000;
        public const int WS_CLIPSIBLINGS = 0x04000000;
        public const int WS_CLIPCHILDREN = 0x02000000;

        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_NOACTIVATE = 0x08000000;

        [DllImport("user32.dll")]
        public static extern IntPtr GetParent(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int MapWindowPoints(IntPtr hWndFrom, IntPtr hWndTo, ref POINT lpPoints, uint cPoints);

        public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern IntPtr FindWindow(string className, string winName);

        [DllImport("user32.dll")]
        public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string winName);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr SendMessageTimeout(
            IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam,
            uint fuFlags, uint uTimeout, out IntPtr lpdwResult);

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
            int x, int y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("shell32.dll")]
        public static extern int SHQueryUserNotificationState(out int qstate);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

        public static string AttachToDesktop(IntPtr hwnd, Rectangle bounds)
        {
            IntPtr progman = FindWindow("Progman", null);
            if (progman == IntPtr.Zero) return "fail: no Progman";

            IntPtr res;
            SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out res);
            SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0), 0, 1000, out res);

            IntPtr workerw = IntPtr.Zero;
            IntPtr defView = IntPtr.Zero;
            EnumWindows((top, lp) =>
            {
                IntPtr dv = FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (dv != IntPtr.Zero)
                {
                    defView = dv;
                    workerw = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
                }
                return true;
            }, IntPtr.Zero);

            bool modern = false;
            IntPtr targetParent = workerw;
            if (targetParent == IntPtr.Zero)
            {
                targetParent = progman;
                modern = true;
            }

            SetParent(hwnd, targetParent);

            // Strip WS_POPUP and apply true WS_CHILD + clipping styles so Explorer redraws never overwrite our window
            int style = GetWindowLong(hwnd, GWL_STYLE);
            style &= ~WS_POPUP;
            style |= (WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN);
            SetWindowLong(hwnd, GWL_STYLE, style);

            int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
            SetWindowLong(hwnd, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);

            POINT pt = new POINT { X = bounds.X, Y = bounds.Y };
            MapWindowPoints(IntPtr.Zero, targetParent, ref pt, 1);

            IntPtr after = (modern && defView != IntPtr.Zero) ? defView : IntPtr.Zero;
            SetWindowPos(hwnd, after, pt.X, pt.Y, bounds.Width, bounds.Height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED);
            return modern ? "attached (Progman child, 24H2)" : "attached (WorkerW, classic)";
        }

        public static string ClassOf(IntPtr h)
        {
            var sb = new StringBuilder(128);
            GetClassName(h, sb, sb.Capacity);
            return sb.ToString();
        }
    }

    // ------------------------------------------------------------------ Wallpaper Window
    internal sealed class WallpaperWindow : Form
    {
        private readonly WebView2 _web = new WebView2();
        private readonly Queue<string> _pending = new Queue<string>();
        private readonly string _url;
        private readonly string _appDir;
        private readonly bool _windowed;
        private Rectangle _bounds;
        private Screen _screen;
        private bool _pageReady;
        private static CoreWebView2Environment _sharedEnv;

        public event EventHandler Ready;

        public Screen TargetScreen => _screen;
        public Rectangle ScreenBounds => _bounds;
        public bool IsMuted { get; set; } = false;

        public WallpaperWindow(Screen screen, string url, string appDir, bool windowed)
        {
            _screen = screen;
            _bounds = screen.Bounds;
            _url = url;
            _appDir = appDir;
            _windowed = windowed;

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Bounds = _bounds;
            BackColor = Color.Black;

            _web.Dock = DockStyle.Fill;
            _web.DefaultBackgroundColor = Color.Black;
            Controls.Add(_web);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.Style |= (Native.WS_CLIPSIBLINGS | Native.WS_CLIPCHILDREN);
                return cp;
            }
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            // Suppress background erase so D3D / WebView2 surface never flickers or gets wiped
        }

        public void MaintainAttachment()
        {
            if (_windowed || !IsHandleCreated) return;
            IntPtr parent = Native.GetParent(Handle);
            if (parent == IntPtr.Zero || !Native.IsWindow(parent) || !Native.IsWindowVisible(Handle))
            {
                Native.AttachToDesktop(Handle, _bounds);
            }
            else
            {
                Native.POINT pt = new Native.POINT { X = _bounds.X, Y = _bounds.Y };
                Native.MapWindowPoints(IntPtr.Zero, parent, ref pt, 1);
                Native.SetWindowPos(Handle, IntPtr.Zero, pt.X, pt.Y, _bounds.Width, _bounds.Height,
                    Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW | Native.SWP_NOZORDER);
            }
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (!_windowed)
            {
                string r = Native.AttachToDesktop(Handle, _bounds);
                Debug.WriteLine("[Anemo] " + r + " on screen " + _screen.DeviceName);
            }
            InitWebViewAsync();
        }

        public void MoveToScreen(Screen screen)
        {
            _screen = screen;
            _bounds = screen.Bounds;
            Bounds = _bounds;
            if (!_windowed)
            {
                Native.AttachToDesktop(Handle, _bounds);
            }
        }

        private async void InitWebViewAsync()
        {
            if (_sharedEnv == null)
            {
                string userData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Anemo", "WebView2");
                var opts = new CoreWebView2EnvironmentOptions(
                    "--autoplay-policy=no-user-gesture-required " +
                    "--enable-gpu-rasterization --enable-features=VaapiVideoDecoder,D3D11VideoDecoder " +
                    "--disable-features=msSmartScreenProtection,Translate,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,ThrottleDisplayNoneAndDisplayInlineScript " +
                    "--disable-background-timer-throttling " +
                    "--disable-backgrounding-occluded-windows " +
                    "--disable-renderer-backgrounding " +
                    "--use-fake-ui-for-media-stream");
                _sharedEnv = await CoreWebView2Environment.CreateAsync(null, userData, opts);
            }

            await _web.EnsureCoreWebView2Async(_sharedEnv);
            var core = _web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.IsMuted = IsMuted;

            core.PermissionRequested += delegate (object s, CoreWebView2PermissionRequestedEventArgs a)
            {
                a.State = CoreWebView2PermissionState.Allow;
            };

            core.WebMessageReceived += delegate (object s, CoreWebView2WebMessageReceivedEventArgs a)
            {
                string json = a.WebMessageAsJson ?? "";
                if (json.Contains("ready"))
                {
                    _pageReady = true;
                    FlushPending();
                    Ready?.Invoke(this, EventArgs.Empty);
                }
            };

            if (_url != null)
            {
                core.Navigate(_url);
            }
            else
            {
                core.SetVirtualHostNameToFolderMapping("anemo.local", _appDir, CoreWebView2HostResourceAccessKind.Allow);
                await core.AddScriptToExecuteOnDocumentCreatedAsync(
                    "if(location.pathname.endsWith('/index.html')){history.replaceState(null,'','/live-wallpaper'+location.search);}");
                core.Navigate("https://anemo.local/index.html?desktop=1");
            }
        }

        public void Send(string json)
        {
            if (_web.CoreWebView2 == null || !_pageReady)
            {
                _pending.Enqueue(json);
                return;
            }
            try { _web.CoreWebView2.PostWebMessageAsJson(json); } catch { }
        }

        private void FlushPending()
        {
            while (_pending.Count > 0)
            {
                try { _web.CoreWebView2.PostWebMessageAsJson(_pending.Dequeue()); } catch { }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                try { _web.Dispose(); } catch { }
            }
            base.Dispose(disposing);
        }
    }

    // ------------------------------------------------------------------ Application Context
    internal sealed class AnemoApplicationContext : ApplicationContext
    {
        private const string RunKeyName = "AnemoLiveWallpaper";

        private readonly NotifyIcon _tray = new NotifyIcon();
        private readonly System.Windows.Forms.Timer _cursorTimer = new System.Windows.Forms.Timer();
        private readonly System.Windows.Forms.Timer _sleepTimer = new System.Windows.Forms.Timer();
        private readonly List<WallpaperWindow> _windows = new List<WallpaperWindow>();

        private readonly string _url;
        private readonly string _appDir;
        private readonly bool _windowed;

        private int _selectedScreenIndex = 0;
        private bool _duplicateAll = false;
        private bool _userPaused = false;
        private bool _autoAsleep = false;
        private bool _locked = false;
        private bool _lastSentPause = false;
        private int _lastCx = int.MinValue, _lastCy = int.MinValue;

        private string _currentMode = "mouse";
        private string _currentIrisStyle = "classic";
        private bool _musicEnabled = false;
        private double _eyelidFollow = 0.56;

        private ToolStripMenuItem _miModeMouse;
        private ToolStripMenuItem _miModePerson;
        private ToolStripMenuItem _miModeGaze;
        private ToolStripMenuItem _miIrisClassic;
        private ToolStripMenuItem _miIrisFocused;
        private ToolStripMenuItem _miMusic;
        private ToolStripMenuItem _miEyelidOff;
        private ToolStripMenuItem _miEyelidSubtle;
        private ToolStripMenuItem _miEyelidNatural;
        private ToolStripMenuItem _miEyelidDynamic;
        private ToolStripMenuItem _miEyelidMax;
        private ToolStripMenuItem _miRunAtStartup;
        private ToolStripMenuItem _miPause;
        private ToolStripMenuItem _miDisplaysMenu;
        private ToolStripMenuItem _miDuplicateAll;

        private static readonly HashSet<string> ShellClasses = new HashSet<string>
        {
            "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "XamlExplorerHostIslandWindow",
            "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland", "SearchApp", "Windows.UI.Core.CoreWindow"
        };

        public AnemoApplicationContext(string url, string appDir, bool windowed)
        {
            _url = url;
            _appDir = appDir;
            _windowed = windowed;

            // Load saved settings if any
            LoadSettings();

            // Setup tray icon
            BuildTray();

            // Instantiate windows
            ApplyMonitorConfiguration();

            // Cursor tracking timer (~30Hz)
            _cursorTimer.Interval = 33;
            _cursorTimer.Tick += delegate { PumpCursor(); };
            _cursorTimer.Start();

            // Auto-sleep check (every 1s)
            _sleepTimer.Interval = 1000;
            _sleepTimer.Tick += delegate { EvaluateSleep(); };
            _sleepTimer.Start();

            // OS events
            Microsoft.Win32.SystemEvents.SessionSwitch += OnSessionSwitch;
            Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
        }

        private bool IsStartupEnabled()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
                {
                    return key != null && key.GetValue(RunKeyName) != null;
                }
            }
            catch { return false; }
        }

        private void SetStartupEnabled(bool enable)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key == null) return;
                    if (enable)
                    {
                        key.SetValue(RunKeyName, "\"" + Application.ExecutablePath + "\"");
                    }
                    else
                    {
                        key.DeleteValue(RunKeyName, false);
                    }
                }
            }
            catch { }
        }

        private void LoadSettings()
        {
            try
            {
                string confFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Anemo", "settings.ini");
                if (File.Exists(confFile))
                {
                    string[] lines = File.ReadAllLines(confFile);
                    foreach (string line in lines)
                    {
                        string[] parts = line.Split(new char[] { '=' }, 2);
                        if (parts.Length != 2) continue;
                        string k = parts[0].Trim().ToLowerInvariant();
                        string v = parts[1].Trim();
                        if (k == "screen") int.TryParse(v, out _selectedScreenIndex);
                        else if (k == "duplicate") bool.TryParse(v, out _duplicateAll);
                        else if (k == "mode")
                        {
                            string m = v.ToLowerInvariant();
                            _currentMode = (m == "gaze" || m == "person") ? m : "mouse";
                        }
                        else if (k == "iris") _currentIrisStyle = v.ToLowerInvariant() == "focused" ? "focused" : "classic";
                        else if (k == "music") bool.TryParse(v, out _musicEnabled);
                        else if (k == "eyelid") double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out _eyelidFollow);
                    }
                }
            }
            catch { }
        }

        private void SaveSettings()
        {
            try
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Anemo");
                Directory.CreateDirectory(dir);
                string confFile = Path.Combine(dir, "settings.ini");
                string content = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "screen={0}\nduplicate={1}\nmode={2}\niris={3}\nmusic={4}\neyelid={5:0.##}\n",
                    _selectedScreenIndex, _duplicateAll, _currentMode, _currentIrisStyle, _musicEnabled, _eyelidFollow);
                File.WriteAllText(confFile, content);
            }
            catch { }
        }

        private void ApplyMonitorConfiguration()
        {
            Screen[] screens = Screen.AllScreens;
            if (_selectedScreenIndex < 0 || _selectedScreenIndex >= screens.Length)
                _selectedScreenIndex = 0;

            // Close existing windows
            foreach (var w in _windows)
            {
                try { w.Close(); w.Dispose(); } catch { }
            }
            _windows.Clear();

            if (_duplicateAll)
            {
                for (int i = 0; i < screens.Length; i++)
                {
                    var win = new WallpaperWindow(screens[i], _url, _appDir, _windowed);
                    win.IsMuted = (i > 0); // Only primary window outputs audio
                    win.Ready += delegate { BroadcastState(); };
                    _windows.Add(win);
                    win.Show();
                }
            }
            else
            {
                Screen target = screens[_selectedScreenIndex];
                var win = new WallpaperWindow(target, _url, _appDir, _windowed);
                win.IsMuted = false;
                win.Ready += delegate { BroadcastState(); };
                _windows.Add(win);
                win.Show();
            }

            UpdateDisplayMenu();
            BroadcastState();
        }

        private void Broadcast(string json)
        {
            foreach (var w in _windows) w.Send(json);
        }

        private void BroadcastState()
        {
            Broadcast("{\"type\":\"mode\",\"value\":\"" + _currentMode + "\"}");
            Broadcast("{\"type\":\"irisStyle\",\"value\":\"" + _currentIrisStyle + "\"}");
            Broadcast("{\"type\":\"music\",\"value\":" + (_musicEnabled ? "true" : "false") + "}");
            Broadcast(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "{{\"type\":\"eyelid\",\"value\":{0:0.##}}}", _eyelidFollow));
            if (_lastSentPause)
            {
                Broadcast("{\"type\":\"pause\",\"value\":true}");
            }
        }

        private void PumpCursor()
        {
            if (_userPaused || _windows.Count == 0) return;
            Native.POINT p;
            if (!Native.GetCursorPos(out p)) return;
            if (p.X == _lastCx && p.Y == _lastCy) return;
            _lastCx = p.X; _lastCy = p.Y;

            foreach (var win in _windows)
            {
                Rectangle b = win.ScreenBounds;
                double nx = (p.X - b.X) / (double)b.Width;
                double ny = (p.Y - b.Y) / (double)b.Height;

                string msg = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "{{\"type\":\"cursor\",\"x\":{0:0.####},\"y\":{1:0.####}}}", nx, ny);
                win.Send(msg);
            }
        }

        private void MaintainWindows()
        {
            foreach (var w in _windows)
            {
                try { w.MaintainAttachment(); } catch { }
            }
        }

        private bool IsDesktopCovered()
        {
            // Only auto-sleep if screen is locked or full-screen exclusive DirectX game is active.
            // Never sleep or blank out when the user is simply working on another monitor!
            int qs;
            if (Native.SHQueryUserNotificationState(out qs) == 0 && qs == 3) // QUNS_RUNNING_D3D_FULL_SCREEN
            {
                return true;
            }
            return false;
        }

        private void EvaluateSleep()
        {
            MaintainWindows(); // Self-healing watchdog: detects Explorer repaints/resets and restores Z-order
            _autoAsleep = IsDesktopCovered();
            ApplyPauseState();
        }

        private void ApplyPauseState()
        {
            bool asleep = _userPaused || _autoAsleep || _locked;
            if (asleep == _lastSentPause) return;
            _lastSentPause = asleep;
            Broadcast("{\"type\":\"pause\",\"value\":" + (asleep ? "true" : "false") + "}");
            if (!asleep) _lastCx = int.MinValue;
        }

        private void OnSessionSwitch(object s, Microsoft.Win32.SessionSwitchEventArgs e)
        {
            if (e.Reason == Microsoft.Win32.SessionSwitchReason.SessionLock) { _locked = true; ApplyPauseState(); }
            else if (e.Reason == Microsoft.Win32.SessionSwitchReason.SessionUnlock) { _locked = false; ApplyPauseState(); }
        }

        private void OnDisplaySettingsChanged(object s, EventArgs e)
        {
            ApplyMonitorConfiguration();
        }

        // ---------------------------------------------------------------- System Tray
        private void BuildTray()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Center Here (Look at Roxy)", null, delegate { Broadcast("{\"type\":\"center\"}"); });
            menu.Items.Add("Calibrate Camera (3s countdown)", null, delegate { Broadcast("{\"type\":\"calibrate\"}"); });
            menu.Items.Add(new ToolStripSeparator());

            // Tracking Mode Submenu
            var miMode = new ToolStripMenuItem("Tracking Mode");
            _miModeMouse = new ToolStripMenuItem("Mouse / Cursor Tracking (Default - No Camera)", null, delegate { SetMode("mouse"); });
            _miModePerson = new ToolStripMenuItem("Person / Room Tracking (Webcam)", null, delegate { SetMode("person"); });
            _miModeGaze = new ToolStripMenuItem("Gaze / Monitor Focus (Webcam)", null, delegate { SetMode("gaze"); });
            miMode.DropDownItems.Add(_miModeMouse);
            miMode.DropDownItems.Add(_miModePerson);
            miMode.DropDownItems.Add(_miModeGaze);
            menu.Items.Add(miMode);

            // Iris Style Submenu (Classic original is default)
            var miIris = new ToolStripMenuItem("Iris Style");
            _miIrisClassic = new ToolStripMenuItem("Classic (Original - Default)", null, delegate { SetIrisStyle("classic"); });
            _miIrisFocused = new ToolStripMenuItem("Focused (Set 2 - Small Pupil)", null, delegate { SetIrisStyle("focused"); });
            miIris.DropDownItems.Add(_miIrisClassic);
            miIris.DropDownItems.Add(_miIrisFocused);
            menu.Items.Add(miIris);

            // Eyelid Follow Submenu
            var miEyelid = new ToolStripMenuItem("Eyelid Follow");
            _miEyelidNatural = new ToolStripMenuItem("Natural (56% - Default)", null, delegate { SetEyelidFollow(0.56); });
            _miEyelidSubtle = new ToolStripMenuItem("Subtle (30%)", null, delegate { SetEyelidFollow(0.30); });
            _miEyelidDynamic = new ToolStripMenuItem("Dynamic (75%)", null, delegate { SetEyelidFollow(0.75); });
            _miEyelidMax = new ToolStripMenuItem("Max (100%)", null, delegate { SetEyelidFollow(1.0); });
            _miEyelidOff = new ToolStripMenuItem("Off (0%)", null, delegate { SetEyelidFollow(0.0); });
            miEyelid.DropDownItems.Add(_miEyelidNatural);
            miEyelid.DropDownItems.Add(_miEyelidSubtle);
            miEyelid.DropDownItems.Add(_miEyelidDynamic);
            miEyelid.DropDownItems.Add(_miEyelidMax);
            miEyelid.DropDownItems.Add(_miEyelidOff);
            menu.Items.Add(miEyelid);

            // Ambient Music (Mushoku Tensei 1-hr loop, off by default)
            _miMusic = new ToolStripMenuItem("Ambient Music (1-hr loop)") { Checked = _musicEnabled };
            _miMusic.Click += delegate
            {
                _musicEnabled = !_musicEnabled;
                _miMusic.Checked = _musicEnabled;
                Broadcast("{\"type\":\"music\",\"value\":" + (_musicEnabled ? "true" : "false") + "}");
                SaveSettings();
            };
            menu.Items.Add(_miMusic);

            menu.Items.Add("Switch Target (Next Person)", null, delegate { Broadcast("{\"type\":\"switchTarget\"}"); });
            menu.Items.Add(new ToolStripSeparator());

            // Displays Submenu
            _miDisplaysMenu = new ToolStripMenuItem("Displays / Monitors");
            menu.Items.Add(_miDisplaysMenu);
            UpdateDisplayMenu();

            // Run at startup toggle
            _miRunAtStartup = new ToolStripMenuItem("Open on Windows Startup") { Checked = IsStartupEnabled() };
            _miRunAtStartup.Click += delegate
            {
                bool next = !IsStartupEnabled();
                SetStartupEnabled(next);
                _miRunAtStartup.Checked = next;
            };
            menu.Items.Add(_miRunAtStartup);

            menu.Items.Add(new ToolStripSeparator());
            _miPause = new ToolStripMenuItem("Pause Wallpaper");
            _miPause.Click += delegate
            {
                _userPaused = !_userPaused;
                _miPause.Checked = _userPaused;
                ApplyPauseState();
            };
            menu.Items.Add(_miPause);

            menu.Items.Add("Exit Anemo", null, delegate { ExitApp(); });

            UpdateModeChecks();

            // Tray icon loading: look for anemo.ico next to exe or embedded
            Icon appIcon = null;
            string icoPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "anemo.ico");
            if (File.Exists(icoPath))
            {
                try { appIcon = new Icon(icoPath); } catch { }
            }
            if (appIcon == null)
            {
                try { appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            }
            if (appIcon == null)
            {
                appIcon = MakeFallbackIcon();
            }

            _tray.Icon = appIcon;
            _tray.Text = "Anemo Live Wallpaper";
            _tray.ContextMenuStrip = menu;
            _tray.Visible = true;
        }

        private void UpdateModeChecks()
        {
            _miModeMouse.Checked = (_currentMode == "mouse");
            _miModePerson.Checked = (_currentMode == "person");
            _miModeGaze.Checked = (_currentMode == "gaze");
            _miIrisClassic.Checked = (_currentIrisStyle == "classic");
            _miIrisFocused.Checked = (_currentIrisStyle == "focused");

            if (_miEyelidNatural != null)
            {
                _miEyelidNatural.Checked = Math.Abs(_eyelidFollow - 0.56) < 0.05;
                _miEyelidSubtle.Checked = Math.Abs(_eyelidFollow - 0.30) < 0.05;
                _miEyelidDynamic.Checked = Math.Abs(_eyelidFollow - 0.75) < 0.05;
                _miEyelidMax.Checked = Math.Abs(_eyelidFollow - 1.0) < 0.05;
                _miEyelidOff.Checked = Math.Abs(_eyelidFollow) < 0.05;
            }
        }

        private void SetMode(string mode)
        {
            _currentMode = mode;
            UpdateModeChecks();
            Broadcast("{\"type\":\"mode\",\"value\":\"" + mode + "\"}");
            SaveSettings();
        }

        private void SetIrisStyle(string style)
        {
            _currentIrisStyle = style;
            UpdateModeChecks();
            Broadcast("{\"type\":\"irisStyle\",\"value\":\"" + style + "\"}");
            SaveSettings();
        }

        private void SetEyelidFollow(double val)
        {
            _eyelidFollow = val;
            UpdateModeChecks();
            Broadcast(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "{{\"type\":\"eyelid\",\"value\":{0:0.##}}}", _eyelidFollow));
            SaveSettings();
        }

        private void UpdateDisplayMenu()
        {
            if (_miDisplaysMenu == null) return;
            _miDisplaysMenu.DropDownItems.Clear();

            Screen[] screens = Screen.AllScreens;
            for (int i = 0; i < screens.Length; i++)
            {
                int idx = i;
                Screen s = screens[i];
                string label = string.Format("Display {0} ({1}x{2}){3}",
                    idx + 1, s.Bounds.Width, s.Bounds.Height,
                    s.Primary ? " [Primary]" : "");

                var mi = new ToolStripMenuItem(label, null, delegate
                {
                    _duplicateAll = false;
                    _selectedScreenIndex = idx;
                    ApplyMonitorConfiguration();
                    SaveSettings();
                })
                {
                    Checked = (!_duplicateAll && _selectedScreenIndex == idx)
                };
                _miDisplaysMenu.DropDownItems.Add(mi);
            }

            _miDisplaysMenu.DropDownItems.Add(new ToolStripSeparator());

            _miDuplicateAll = new ToolStripMenuItem("Duplicate on All Displays", null, delegate
            {
                _duplicateAll = !_duplicateAll;
                ApplyMonitorConfiguration();
                SaveSettings();
            })
            {
                Checked = _duplicateAll
            };
            _miDisplaysMenu.DropDownItems.Add(_miDuplicateAll);
        }

        private Icon MakeFallbackIcon()
        {
            using (var bmp = new Bitmap(32, 32))
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.FromArgb(12, 127, 242));
                using (var pen = new Pen(Color.White, 3))
                {
                    g.DrawEllipse(pen, 6, 6, 20, 20);
                }
                using (var brush = new SolidBrush(Color.White))
                {
                    g.FillEllipse(brush, 13, 13, 6, 6);
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        private void ExitApp()
        {
            _tray.Visible = false;
            _cursorTimer.Stop();
            _sleepTimer.Stop();
            foreach (var w in _windows)
            {
                try { w.Close(); w.Dispose(); } catch { }
            }
            Application.Exit();
        }
    }

    // ------------------------------------------------------------------ Entry Point
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "Anemo.SingleInstance", out created))
            {
                if (!created)
                {
                    MessageBox.Show("Anemo Live Wallpaper is already running in the system tray.",
                        "Anemo", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
                Application.EnableVisualStyles();

                string url = null;
                bool windowed = false;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--dev") url = "http://localhost:5173/live-wallpaper?desktop=1";
                    else if (args[i] == "--url" && i + 1 < args.Length) url = args[++i];
                    else if (args[i] == "--windowed") windowed = true;
                }

                string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                string appDir = Path.Combine(exeDir, "app");

                if (url == null && !File.Exists(Path.Combine(appDir, "index.html")))
                {
                    string localProg = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Anemo", "app");
                    string localApp = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Anemo", "app");
                    if (File.Exists(Path.Combine(localProg, "index.html"))) appDir = localProg;
                    else if (File.Exists(Path.Combine(localApp, "index.html"))) appDir = localApp;
                }

                if (url == null && !File.Exists(Path.Combine(appDir, "index.html")))
                {
                    MessageBox.Show(
                        "Packaged Anemo web app not found at:\n" + appDir + "\n\n" +
                        "Make sure the 'app' folder is present next to Anemo.exe or run AnemoSetup.exe.",
                        "Anemo Live Wallpaper", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                Application.Run(new AnemoApplicationContext(url, appDir, windowed));
            }
        }
    }
}
