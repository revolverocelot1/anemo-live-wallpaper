// Installer.cs — Single-File Standalone Installer for Anemo Live Wallpaper.
//
// Compiles into: AnemoSetup.exe (Single standalone installer executable)
// Embeds: The full Anemo application payload as an embedded resource.
//
// Actions performed:
//  1. Unpacks all application files into %LocalAppData%\Programs\Anemo
//  2. Creates a Desktop Shortcut with the official anemo.ico icon
//  3. Creates a Start Menu shortcut
//  4. Optionally registers "Run on Windows Startup"
//  5. Launches Anemo.exe immediately

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AnemoInstaller
{
    internal static class Program
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
                PerformInstall(true, true, true);
                return;
            }

            Application.Run(new InstallerForm());
        }

        public static void PerformInstall(bool createDesktopShortcut, bool runOnStartup, bool launchNow)
        {
            string targetDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Anemo");
            Directory.CreateDirectory(targetDir);

            // Extract embedded payload zip
            var asm = Assembly.GetExecutingAssembly();
            using (var stream = asm.GetManifestResourceStream("AnemoPayload.zip"))
            {
                if (stream == null)
                {
                    throw new InvalidOperationException("Embedded AnemoPayload.zip resource was not found in installer.");
                }

                string tempZip = Path.Combine(Path.GetTempPath(), "AnemoPayload_" + Guid.NewGuid().ToString("N") + ".zip");
                using (var fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                {
                    stream.CopyTo(fs);
                }

                try
                {
                    // Terminate any running Anemo.exe process before replacing
                    foreach (var p in Process.GetProcessesByName("Anemo"))
                    {
                        try { p.Kill(); p.WaitForExit(1500); } catch { }
                    }

                    ZipFile.ExtractToDirectory(tempZip, targetDir);
                }
                catch
                {
                    // If files exist, overwrite
                    using (var archive = ZipFile.OpenRead(tempZip))
                    {
                        foreach (var entry in archive.Entries)
                        {
                            string dest = Path.Combine(targetDir, entry.FullName);
                            if (string.IsNullOrEmpty(entry.Name))
                            {
                                Directory.CreateDirectory(dest);
                                continue;
                            }
                            Directory.CreateDirectory(Path.GetDirectoryName(dest));
                            entry.ExtractToFile(dest, true);
                        }
                    }
                }
                finally
                {
                    try { File.Delete(tempZip); } catch { }
                }
            }

            string targetExe = Path.Combine(targetDir, "Anemo.exe");
            string icoPath = Path.Combine(targetDir, "anemo.ico");

            // Desktop shortcut
            if (createDesktopShortcut)
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string lnk = Path.Combine(desktop, "Anemo Live Wallpaper.lnk");
                CreateShortcut(lnk, targetExe, targetDir, icoPath, "Anemo Live Wallpaper");
            }

            // Start menu shortcut
            string startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Anemo Live Wallpaper.lnk");
            CreateShortcut(startMenu, targetExe, targetDir, icoPath, "Anemo Live Wallpaper");

            // Windows Startup
            if (runOnStartup)
            {
                try
                {
                    using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                    {
                        if (key != null)
                        {
                            key.SetValue("AnemoLiveWallpaper", "\"" + targetExe + "\"");
                        }
                    }
                }
                catch { }
            }

            // Launch immediately
            if (launchNow && File.Exists(targetExe))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = targetExe,
                    WorkingDirectory = targetDir
                });
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string iconPath, string desc)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic sc = shell.CreateShortcut(shortcutPath);
                sc.TargetPath = targetPath;
                sc.WorkingDirectory = workingDir;
                sc.Description = desc;
                if (File.Exists(iconPath))
                {
                    sc.IconLocation = iconPath + ",0";
                }
                sc.Save();
            }
            catch { }
        }
    }

    internal sealed class InstallerForm : Form
    {
        private readonly CheckBox _chkDesktop = new CheckBox();
        private readonly CheckBox _chkStartup = new CheckBox();
        private readonly CheckBox _chkLaunch = new CheckBox();
        private readonly Button _btnInstall = new Button();
        private readonly Label _lblStatus = new Label();
        private readonly ProgressBar _progress = new ProgressBar();

        public InstallerForm()
        {
            Text = "Anemo Live Wallpaper Setup";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            ClientSize = new Size(460, 310);
            BackColor = Color.FromArgb(15, 17, 23);
            ForeColor = Color.White;

            Icon = null;
            try
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch { }

            // Title Header
            var lblTitle = new Label
            {
                Text = "ANEMO LIVE WALLPAPER",
                Font = new Font("Segoe UI", 14, FontStyle.Bold),
                ForeColor = Color.FromArgb(56, 189, 248),
                Location = new Point(24, 20),
                AutoSize = true
            };
            Controls.Add(lblTitle);

            var lblSub = new Label
            {
                Text = "Interactive 2.5D Living Desktop Engine — v1.0.3",
                Font = new Font("Segoe UI", 9, FontStyle.Regular),
                ForeColor = Color.FromArgb(156, 163, 175),
                Location = new Point(26, 48),
                AutoSize = true
            };
            Controls.Add(lblSub);

            // Install directory note
            string installPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Anemo");
            var lblDir = new Label
            {
                Text = "Installs to: " + installPath,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(107, 114, 128),
                Location = new Point(26, 80),
                Size = new Size(410, 20)
            };
            Controls.Add(lblDir);

            // Options
            _chkDesktop.Text = "Create Desktop Shortcut";
            _chkDesktop.Checked = true;
            _chkDesktop.Font = new Font("Segoe UI", 9.5f);
            _chkDesktop.ForeColor = Color.White;
            _chkDesktop.Location = new Point(30, 115);
            _chkDesktop.AutoSize = true;
            Controls.Add(_chkDesktop);

            _chkStartup.Text = "Run Anemo on Windows Startup";
            _chkStartup.Checked = true;
            _chkStartup.Font = new Font("Segoe UI", 9.5f);
            _chkStartup.ForeColor = Color.White;
            _chkStartup.Location = new Point(30, 145);
            _chkStartup.AutoSize = true;
            Controls.Add(_chkStartup);

            _chkLaunch.Text = "Launch Anemo Live Wallpaper immediately";
            _chkLaunch.Checked = true;
            _chkLaunch.Font = new Font("Segoe UI", 9.5f);
            _chkLaunch.ForeColor = Color.White;
            _chkLaunch.Location = new Point(30, 175);
            _chkLaunch.AutoSize = true;
            Controls.Add(_chkLaunch);

            // Progress bar (initially hidden)
            _progress.Location = new Point(30, 215);
            _progress.Size = new Size(400, 10);
            _progress.Style = ProgressBarStyle.Marquee;
            _progress.Visible = false;
            Controls.Add(_progress);

            // Status label
            _lblStatus.Text = "";
            _lblStatus.Font = new Font("Segoe UI", 9f);
            _lblStatus.ForeColor = Color.FromArgb(56, 189, 248);
            _lblStatus.Location = new Point(30, 230);
            _lblStatus.AutoSize = true;
            Controls.Add(_lblStatus);

            // Install Button
            _btnInstall.Text = "Install && Launch";
            _btnInstall.Font = new Font("Segoe UI", 10.5f, FontStyle.Bold);
            _btnInstall.BackColor = Color.FromArgb(12, 127, 242);
            _btnInstall.ForeColor = Color.White;
            _btnInstall.FlatStyle = FlatStyle.Flat;
            _btnInstall.FlatAppearance.BorderSize = 0;
            _btnInstall.Size = new Size(180, 42);
            _btnInstall.Location = new Point(250, 250);
            _btnInstall.Cursor = Cursors.Hand;
            _btnInstall.Click += BtnInstall_Click;
            Controls.Add(_btnInstall);
        }

        private async void BtnInstall_Click(object sender, EventArgs e)
        {
            _btnInstall.Enabled = false;
            _chkDesktop.Enabled = false;
            _chkStartup.Enabled = false;
            _chkLaunch.Enabled = false;

            _progress.Visible = true;
            _lblStatus.Text = "Installing Anemo Live Wallpaper...";

            bool d = _chkDesktop.Checked;
            bool s = _chkStartup.Checked;
            bool l = _chkLaunch.Checked;

            try
            {
                await System.Threading.Tasks.Task.Run(() =>
                {
                    Program.PerformInstall(d, s, l);
                });

                _lblStatus.Text = "Installation complete! Anemo is now running.";
                await System.Threading.Tasks.Task.Delay(1200);
                Close();
            }
            catch (Exception ex)
            {
                _progress.Visible = false;
                _btnInstall.Enabled = true;
                _lblStatus.ForeColor = Color.Red;
                _lblStatus.Text = "Installation error: " + ex.Message;
                MessageBox.Show("Installation failed:\n" + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
