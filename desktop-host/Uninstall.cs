// Uninstall.cs — Standalone Uninstaller for Anemo Live Wallpaper.
//
// Compiles into: Uninstall.exe
// Removes:
//  1. Running Anemo.exe processes
//  2. Windows Startup registry entry (HKCU\Software\Microsoft\Windows\CurrentVersion\Run)
//  3. Windows Add/Remove Programs entry (HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AnemoLiveWallpaper)
//  4. Desktop & Start Menu shortcuts
//  5. Installed application directory (%LocalAppData%\Programs\Anemo)

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AnemoInstaller
{
    internal static class UninstallerProgram
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = false;
            foreach (var a in args)
            {
                if (a == "/s" || a == "/silent" || a == "--silent" || a == "-s")
                    silent = true;
            }

            if (silent)
            {
                PerformUninstall();
                return;
            }

            Application.Run(new UninstallerForm());
        }

        public static void PerformUninstall()
        {
            // 1. Terminate running Anemo processes
            foreach (var p in Process.GetProcessesByName("Anemo"))
            {
                try
                {
                    p.Kill();
                    p.WaitForExit(2000);
                }
                catch { }
            }

            // 2. Remove Windows Startup Registry Key
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null)
                    {
                        key.DeleteValue("AnemoLiveWallpaper", false);
                    }
                }
            }
            catch { }

            // 3. Remove Windows Add/Remove Programs Registry Key
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\AnemoLiveWallpaper", false);
            }
            catch { }

            // 4. Remove Desktop Shortcut
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string lnk = Path.Combine(desktop, "Anemo Live Wallpaper.lnk");
                if (File.Exists(lnk)) File.Delete(lnk);
            }
            catch { }

            // 5. Remove Start Menu Shortcuts
            try
            {
                string startMenu = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                string lnk1 = Path.Combine(startMenu, "Anemo Live Wallpaper.lnk");
                string lnk2 = Path.Combine(startMenu, "Uninstall Anemo Live Wallpaper.lnk");
                if (File.Exists(lnk1)) File.Delete(lnk1);
                if (File.Exists(lnk2)) File.Delete(lnk2);

                string startFolder = Path.Combine(startMenu, "Anemo Live Wallpaper");
                if (Directory.Exists(startFolder))
                {
                    Directory.Delete(startFolder, true);
                }
            }
            catch { }

            // 6. Delete Application Directory via detached self-cleaning helper
            try
            {
                string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
                if (Directory.Exists(installDir))
                {
                    // Spawn hidden cmd that waits for Uninstall.exe to exit, then removes directory
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = $"/c ping 127.0.0.1 -n 2 > nul & rmdir /s /q \"{installDir}\"",
                        WindowStyle = ProcessWindowStyle.Hidden,
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    Process.Start(psi);
                }
            }
            catch { }
        }
    }

    internal sealed class UninstallerForm : Form
    {
        private readonly Button _btnUninstall = new Button();
        private readonly Button _btnCancel = new Button();
        private readonly Label _lblStatus = new Label();
        private readonly ProgressBar _progress = new ProgressBar();

        public UninstallerForm()
        {
            Text = "Uninstall Anemo Live Wallpaper";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            ClientSize = new Size(460, 260);
            BackColor = Color.FromArgb(15, 17, 23);
            ForeColor = Color.White;

            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { }

            // Title Header
            var lblTitle = new Label
            {
                Text = "UNINSTALL ANEMO LIVE WALLPAPER",
                Font = new Font("Segoe UI", 13, FontStyle.Bold),
                ForeColor = Color.FromArgb(248, 113, 113),
                Location = new Point(24, 22),
                AutoSize = true
            };
            Controls.Add(lblTitle);

            var lblPrompt = new Label
            {
                Text = "Are you sure you want to completely remove Anemo Live Wallpaper\nand all of its components from your computer?",
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(209, 213, 219),
                Location = new Point(26, 62),
                Size = new Size(410, 42)
            };
            Controls.Add(lblPrompt);

            string installPath = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            var lblDir = new Label
            {
                Text = "Location: " + installPath,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(107, 114, 128),
                Location = new Point(26, 118),
                Size = new Size(410, 20)
            };
            Controls.Add(lblDir);

            // Progress bar
            _progress.Location = new Point(30, 150);
            _progress.Size = new Size(400, 8);
            _progress.Style = ProgressBarStyle.Marquee;
            _progress.Visible = false;
            Controls.Add(_progress);

            // Status label
            _lblStatus.Text = "";
            _lblStatus.Font = new Font("Segoe UI", 9f);
            _lblStatus.ForeColor = Color.FromArgb(56, 189, 248);
            _lblStatus.Location = new Point(30, 165);
            _lblStatus.AutoSize = true;
            Controls.Add(_lblStatus);

            // Cancel Button
            _btnCancel.Text = "Cancel";
            _btnCancel.Font = new Font("Segoe UI", 9.5f);
            _btnCancel.BackColor = Color.FromArgb(31, 41, 55);
            _btnCancel.ForeColor = Color.White;
            _btnCancel.FlatStyle = FlatStyle.Flat;
            _btnCancel.FlatAppearance.BorderSize = 0;
            _btnCancel.Size = new Size(100, 36);
            _btnCancel.Location = new Point(210, 200);
            _btnCancel.Cursor = Cursors.Hand;
            _btnCancel.Click += (s, e) => Close();
            Controls.Add(_btnCancel);

            // Uninstall Button
            _btnUninstall.Text = "Uninstall";
            _btnUninstall.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            _btnUninstall.BackColor = Color.FromArgb(220, 38, 38);
            _btnUninstall.ForeColor = Color.White;
            _btnUninstall.FlatStyle = FlatStyle.Flat;
            _btnUninstall.FlatAppearance.BorderSize = 0;
            _btnUninstall.Size = new Size(110, 36);
            _btnUninstall.Location = new Point(320, 200);
            _btnUninstall.Cursor = Cursors.Hand;
            _btnUninstall.Click += BtnUninstall_Click;
            Controls.Add(_btnUninstall);
        }

        private async void BtnUninstall_Click(object sender, EventArgs e)
        {
            _btnUninstall.Enabled = false;
            _btnCancel.Enabled = false;
            _progress.Visible = true;
            _lblStatus.Text = "Removing Anemo Live Wallpaper components...";

            try
            {
                await System.Threading.Tasks.Task.Run(() =>
                {
                    UninstallerProgram.PerformUninstall();
                });

                _lblStatus.Text = "Anemo Live Wallpaper was successfully uninstalled.";
                _lblStatus.ForeColor = Color.FromArgb(52, 211, 153);
                await System.Threading.Tasks.Task.Delay(1000);
                Close();
            }
            catch (Exception ex)
            {
                _progress.Visible = false;
                _btnUninstall.Enabled = true;
                _btnCancel.Enabled = true;
                _lblStatus.ForeColor = Color.Red;
                _lblStatus.Text = "Error during uninstall: " + ex.Message;
                MessageBox.Show("Uninstallation encountered an error:\n" + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
