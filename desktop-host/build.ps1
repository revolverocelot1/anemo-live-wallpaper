<#
  Anemo Live Wallpaper Build Script
  Produces both:
    1. Single-File Standalone Installer: anemo-wallpaper\out\AnemoSetup.exe
    2. Portable Directory / Zip: anemo-wallpaper\out\Anemo-Live-Wallpaper-Portable.zip
#>
param([switch]$SkipWeb)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$outDir = Join-Path $here 'out'
$anemoDir = Join-Path $outDir 'Anemo'
$appDir = Join-Path $anemoDir 'app'
$pkgVersion = '1.0.2739.15'

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Building Anemo Live Wallpaper Engine   " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1) Locate Roslyn csc.exe
$csc = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio','C:\Program Files (x86)\Microsoft Visual Studio' `
        -Recurse -Filter csc.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Roslyn' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $csc) { throw 'Roslyn csc.exe not found. Visual Studio 2022 Build Tools required.' }
Write-Host "[1/7] Found Roslyn Compiler: $csc" -ForegroundColor Green

# 2) Fetch WebView2 SDK
$cache = Join-Path $here '.cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$nupkg = Join-Path $cache "webview2-$pkgVersion.zip"

$oldCacheNupkg = Join-Path $root "desktop-wallpaper\.cache\webview2-$pkgVersion.zip"
if (Test-Path $oldCacheNupkg) {
    Copy-Item $oldCacheNupkg $nupkg -Force
} elseif (-not (Test-Path $nupkg)) {
    Write-Host "[2/7] Downloading WebView2 SDK from NuGet..." -ForegroundColor Yellow
    Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$pkgVersion" -OutFile $nupkg
}

$sdk = Join-Path $cache "sdk-$pkgVersion"
if (-not (Test-Path $sdk)) {
    Write-Host "[2/7] Extracting WebView2 SDK..." -ForegroundColor Yellow
    Expand-Archive $nupkg $sdk -Force
}
$core = Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$wf   = Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$ldr  = Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll'
Write-Host "[2/7] WebView2 SDK ready." -ForegroundColor Green

# 3) Ensure web assets are built in web-engine/dist/
$webDir = Join-Path $root 'web-engine'
$dist = Join-Path $webDir 'dist'
if ((-not $SkipWeb) -or (-not (Test-Path $dist))) {
    Write-Host "[3/7] Building production web assets (Vite in web-engine)..." -ForegroundColor Yellow
    Push-Location $webDir
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Vite build failed' }
    } finally {
        Pop-Location
    }
}
Write-Host "[3/7] Web build verified in web-engine/dist/" -ForegroundColor Green

# 4) Prepare clean output directory
New-Item -ItemType Directory -Force $anemoDir | Out-Null

# 5) Compile Anemo.exe with website icon
$ico = Join-Path $here 'anemo.ico'
Write-Host "[4/7] Compiling Anemo.exe with Roslyn..." -ForegroundColor Yellow
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    /win32icon:"$ico" `
    /out:"$anemoDir\Anemo.exe" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:"$core" /r:"$wf" `
    "$here\Anemo.cs"

if ($LASTEXITCODE -ne 0) { throw 'csc compilation failed' }
Write-Host "[4/7] Successfully compiled Anemo.exe!" -ForegroundColor Green

# Copy dependencies
Copy-Item $core, $wf, $ldr, $ico $anemoDir -Force

# 6) Package ONLY the live-wallpaper files (strictly exclude 1.3GB of unrelated models)
Write-Host "[5/7] Assembling lightweight app runtime..." -ForegroundColor Yellow
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
New-Item -ItemType Directory -Force $appDir | Out-Null

# Copy essential root web files
Get-ChildItem $dist -File | Where-Object {
    $_.Name -in @('index.html', 'A_logo.png', 'favicon.png', 'favicon.ico', 'manifest.json', 'robots.txt')
} | Copy-Item -Destination $appDir -Force

# Copy live-wallpaper textures
$lwSrc = Join-Path $dist 'live-wallpaper'
if (Test-Path $lwSrc) {
    $lwDest = Join-Path $appDir 'live-wallpaper'
    New-Item -ItemType Directory -Force $lwDest | Out-Null
    Copy-Item "$lwSrc\*" $lwDest -Recurse -Force -Exclude 'bg_loop_fwd_only.mp4'
}

# Copy assets (JS / CSS)
$assetsSrc = Join-Path $dist 'assets'
if (Test-Path $assetsSrc) {
    Copy-Item $assetsSrc (Join-Path $appDir 'assets') -Recurse -Force
}

# Calculate final app folder size
$appSize = (Get-ChildItem $appDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$appSizeMB = [math]::round($appSize / 1MB, 2)
Write-Host "      App bundle size: $appSizeMB MB (clean, zero unrelated models!)" -ForegroundColor Green

# 7) Create Portable Distribution Zip
Write-Host "[6/7] Generating portable distribution zip..." -ForegroundColor Yellow
$zipPath = Join-Path $outDir 'Anemo-Live-Wallpaper-Portable.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$anemoDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

$zipSize = (Get-Item $zipPath).Length
$zipSizeMB = [math]::round($zipSize / 1MB, 2)
Write-Host "      Portable zip ready: $zipPath ($zipSizeMB MB)" -ForegroundColor Green

# 8) Compile Single-File Standalone Installer: AnemoSetup.exe
Write-Host "[7/7] Compiling Single-File Standalone Installer: AnemoSetup.exe..." -ForegroundColor Yellow
$installerExe = Join-Path $outDir 'AnemoSetup.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    /win32icon:"$ico" `
    /resource:"$zipPath,AnemoPayload.zip" `
    /out:"$installerExe" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
    "$here\Installer.cs"

if ($LASTEXITCODE -ne 0) { throw 'AnemoSetup.exe compilation failed' }
$setupSize = (Get-Item $installerExe).Length
$setupSizeMB = [math]::round($setupSize / 1MB, 2)

Write-Host "==========================================" -ForegroundColor Green
Write-Host "  ALL BUILDS COMPLETE!" -ForegroundColor Green
Write-Host "  1. Single-File Installer: $installerExe ($setupSizeMB MB)" -ForegroundColor Green
Write-Host "  2. Portable Executable:   $anemoDir\Anemo.exe" -ForegroundColor Green
Write-Host "  3. Portable Zip:          $zipPath ($zipSizeMB MB)" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
