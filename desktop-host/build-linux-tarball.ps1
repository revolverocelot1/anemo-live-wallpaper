<#
  Anemo Live Wallpaper — Linux Tarball Builder
  Produces:
    desktop-host\out\Anemo-Live-Wallpaper-Linux-x64.tar.gz
#>
param([switch]$SkipWeb)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$outDir = Join-Path $here 'out'
$linuxDir = Join-Path $root 'linux-host'
$webDir = Join-Path $root 'web-engine'
$distDir = Join-Path $webDir 'dist'

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Building Anemo Live Wallpaper for Linux " -ForegroundColor Cyan
Write-Host "  Version: 1.0.4 | Publisher: Anemoia     " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Ensure Web Assets are Built
if ((-not $SkipWeb) -or (-not (Test-Path $distDir))) {
    Write-Host "[1/3] Building production web assets (Vite)..." -ForegroundColor Yellow
    Push-Location $webDir
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Vite build failed' }
    } finally {
        Pop-Location
    }
}
Write-Host "[1/3] Web build verified in web-engine/dist/" -ForegroundColor Green

# 2. Stage Linux Release Files
Write-Host "[2/3] Assembling Linux package staging directory..." -ForegroundColor Yellow
$stageDir = Join-Path $outDir 'linux-staging\anemo-live-wallpaper'
if (Test-Path $stageDir) { Remove-Item (Split-Path $stageDir -Parent) -Recurse -Force }
New-Item -ItemType Directory -Force $stageDir | Out-Null

# Copy Linux Host files
Copy-Item (Join-Path $linuxDir 'anemo.py') $stageDir -Force
Copy-Item (Join-Path $linuxDir 'install.sh') $stageDir -Force
Copy-Item (Join-Path $linuxDir 'uninstall.sh') $stageDir -Force
Copy-Item (Join-Path $linuxDir 'anemo.desktop') $stageDir -Force
Copy-Item (Join-Path $linuxDir 'anemo.png') $stageDir -Force

# Copy App Runtime
$stageApp = Join-Path $stageDir 'app'
New-Item -ItemType Directory -Force $stageApp | Out-Null

Get-ChildItem $distDir -File | Where-Object {
    $_.Name -in @('index.html', 'A_logo.png', 'favicon.png', 'favicon.ico', 'manifest.json', 'robots.txt')
} | Copy-Item -Destination $stageApp -Force

$lwSrc = Join-Path $distDir 'live-wallpaper'
if (Test-Path $lwSrc) {
    $lwDest = Join-Path $stageApp 'live-wallpaper'
    New-Item -ItemType Directory -Force $lwDest | Out-Null
    Copy-Item "$lwSrc\*" $lwDest -Recurse -Force -Exclude 'bg_loop_fwd_only.mp4'
}

$assetsSrc = Join-Path $distDir 'assets'
if (Test-Path $assetsSrc) {
    Copy-Item $assetsSrc (Join-Path $stageApp 'assets') -Recurse -Force
}

# 3. Create POSIX Tarball via Python (preserves 0755 execute permissions)
Write-Host "[3/3] Creating compressed tarball (Anemo-Live-Wallpaper-Linux-x64.tar.gz)..." -ForegroundColor Yellow
$tarPath = Join-Path $outDir 'Anemo-Live-Wallpaper-Linux-x64.tar.gz'
if (Test-Path $tarPath) { Remove-Item $tarPath -Force }

$pyScript = @"
import os, tarfile

src_dir = r'$stageDir'
tar_path = r'$tarPath'

with tarfile.open(tar_path, 'w:gz') as tar:
    for root, dirs, files in os.walk(src_dir):
        for f in files:
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, os.path.dirname(src_dir))
            ti = tar.gettarinfo(full_path, arcname=rel_path)
            # Ensure Linux executable bit on scripts
            if f.endswith('.sh') or f.endswith('.py'):
                ti.mode = 0o755
            else:
                ti.mode = 0o644
            ti.uname = 'anemoia'
            ti.gname = 'anemoia'
            with open(full_path, 'rb') as f_obj:
                tar.addfile(ti, f_obj)

print('Tarball successfully created!')
"@

python -c "$pyScript"

# Clean up staging
Remove-Item (Split-Path $stageDir -Parent) -Recurse -Force

$tarSize = (Get-Item $tarPath).Length
$tarSizeMB = [math]::round($tarSize / 1MB, 2)

Write-Host "==========================================" -ForegroundColor Green
Write-Host "  LINUX BUILD COMPLETE!" -ForegroundColor Green
Write-Host "  Package: $tarPath ($tarSizeMB MB)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
