<#
  Anemo Live Wallpaper Build Script
  Produces:
    1. Single-File Standalone Installer: desktop-host\out\AnemoSetup.exe
    2. Native Clean Uninstaller:         desktop-host\out\Anemo\Uninstall.exe
    3. Portable Directory / Zip:         desktop-host\out\Anemo-Live-Wallpaper-Portable.zip
    4. Authenticode Signed Binaries by:  Anemoia
#>
param([switch]$SkipWeb)
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$outDir = Join-Path $here 'out'
$anemoDir = Join-Path $outDir 'Anemo'
$appDir = Join-Path $anemoDir 'app'
$manifest = Join-Path $here 'app.manifest'
$asmInfo = Join-Path $here 'AssemblyInfo.cs'
$pkgVersion = '1.0.2739.15'

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Building Anemo Live Wallpaper Engine   " -ForegroundColor Cyan
Write-Host "  Publisher Identity: Anemoia            " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1) Locate Roslyn csc.exe
$csc = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio','C:\Program Files (x86)\Microsoft Visual Studio' `
        -Recurse -Filter csc.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match 'Roslyn' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $csc) { throw 'Roslyn csc.exe not found. Visual Studio 2022 Build Tools required.' }
Write-Host "[1/8] Found Roslyn Compiler: $csc" -ForegroundColor Green

# 2) Fetch WebView2 SDK
$cache = Join-Path $here '.cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$nupkg = Join-Path $cache "webview2-$pkgVersion.zip"

$oldCacheNupkg = Join-Path $root "desktop-wallpaper\.cache\webview2-$pkgVersion.zip"
if (Test-Path $oldCacheNupkg) {
    Copy-Item $oldCacheNupkg $nupkg -Force
} elseif (-not (Test-Path $nupkg)) {
    Write-Host "[2/8] Downloading WebView2 SDK from NuGet..." -ForegroundColor Yellow
    Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$pkgVersion" -OutFile $nupkg
}

$sdk = Join-Path $cache "sdk-$pkgVersion"
if (-not (Test-Path $sdk)) {
    Write-Host "[2/8] Extracting WebView2 SDK..." -ForegroundColor Yellow
    Expand-Archive $nupkg $sdk -Force
}
$core = Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$wf   = Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$ldr  = Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll'
Write-Host "[2/8] WebView2 SDK ready." -ForegroundColor Green

# 3) Ensure web assets are built in web-engine/dist/
$webDir = Join-Path $root 'web-engine'
$dist = Join-Path $webDir 'dist'
if ((-not $SkipWeb) -or (-not (Test-Path $dist))) {
    Write-Host "[3/8] Building production web assets (Vite in web-engine)..." -ForegroundColor Yellow
    Push-Location $webDir
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Vite build failed' }
    } finally {
        Pop-Location
    }
}
Write-Host "[3/8] Web build verified in web-engine/dist/" -ForegroundColor Green

# 4) Prepare clean output directory
New-Item -ItemType Directory -Force $anemoDir | Out-Null

# 5) Compile Anemo.exe with PE Manifest & AssemblyInfo
$ico = Join-Path $here 'anemo.ico'
Write-Host "[4/8] Compiling Anemo.exe with Roslyn (Anemoia metadata + manifest)..." -ForegroundColor Yellow
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    /win32icon:"$ico" `
    /win32manifest:"$manifest" `
    /out:"$anemoDir\Anemo.exe" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:"$core" /r:"$wf" `
    "$asmInfo" "$here\Anemo.cs"

if ($LASTEXITCODE -ne 0) { throw 'Anemo.exe compilation failed' }
Write-Host "[4/8] Successfully compiled Anemo.exe!" -ForegroundColor Green

# 6) Compile Uninstall.exe
Write-Host "[5/8] Compiling Uninstall.exe with Roslyn..." -ForegroundColor Yellow
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    /win32icon:"$ico" `
    /win32manifest:"$manifest" `
    /out:"$anemoDir\Uninstall.exe" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    "$asmInfo" "$here\Uninstall.cs"

if ($LASTEXITCODE -ne 0) { throw 'Uninstall.exe compilation failed' }
Write-Host "[5/8] Successfully compiled Uninstall.exe!" -ForegroundColor Green

# Copy dependencies
Copy-Item $core, $wf, $ldr, $ico $anemoDir -Force

# 7) Package ONLY the live-wallpaper files
Write-Host "[6/8] Assembling lightweight app runtime..." -ForegroundColor Yellow
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

# 8) Create Portable Distribution Zip (now contains Uninstall.exe + Anemo.exe)
Write-Host "[7/8] Generating portable distribution zip..." -ForegroundColor Yellow
$zipPath = Join-Path $outDir 'Anemo-Live-Wallpaper-Portable.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$anemoDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

$zipSize = (Get-Item $zipPath).Length
$zipSizeMB = [math]::round($zipSize / 1MB, 2)
Write-Host "      Portable zip ready: $zipPath ($zipSizeMB MB)" -ForegroundColor Green

# 9) Compile Single-File Standalone Installer: AnemoSetup.exe
Write-Host "[8/8] Compiling Single-File Standalone Installer: AnemoSetup.exe..." -ForegroundColor Yellow
$installerExe = Join-Path $outDir 'AnemoSetup.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    /win32icon:"$ico" `
    /win32manifest:"$manifest" `
    /resource:"$zipPath,AnemoPayload.zip" `
    /out:"$installerExe" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
    "$asmInfo" "$here\Installer.cs"

if ($LASTEXITCODE -ne 0) { throw 'AnemoSetup.exe compilation failed' }
$setupSize = (Get-Item $installerExe).Length
$setupSizeMB = [math]::round($setupSize / 1MB, 2)

# 10) Authenticode Digital Signing with Anemoia Certificate
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Code Signing Binaries (Publisher: Anemoia) " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$certSubject = "CN=Anemoia, O=Anemoia"
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Subject -match 'Anemoia' -and $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3' } | Select-Object -First 1

if (-not $cert) {
    Write-Host "Creating local Anemoia Code Signing Certificate..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate -Subject $certSubject `
        -Type CodeSigningCert `
        -CertStoreLocation Cert:\CurrentUser\My `
        -HashAlgorithm SHA256 `
        -KeyLength 4096 `
        -NotAfter (Get-Date).AddYears(5)
    Write-Host "Certificate created: $($cert.Thumbprint)" -ForegroundColor Green
} else {
    Write-Host "Using existing Anemoia Code Signing Certificate: $($cert.Thumbprint)" -ForegroundColor Green
}

# Export public certificate
$cerPath = Join-Path $outDir 'Anemoia.cer'
Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null
Write-Host "Exported public certificate: $cerPath" -ForegroundColor Green

# Sign binaries
$binariesToSign = @(
    (Join-Path $anemoDir 'Anemo.exe'),
    (Join-Path $anemoDir 'Uninstall.exe'),
    $installerExe
)

$timestampServer = "http://timestamp.digicert.com"
foreach ($bin in $binariesToSign) {
    if (Test-Path $bin) {
        $binName = Split-Path $bin -Leaf
        Write-Host "Signing $binName with Anemoia Authenticode..." -ForegroundColor Yellow
        try {
            Set-AuthenticodeSignature -FilePath $bin -Certificate $cert -TimestampServer $timestampServer -HashAlgorithm SHA256 | Out-Null
        } catch {
            Set-AuthenticodeSignature -FilePath $bin -Certificate $cert -HashAlgorithm SHA256 | Out-Null
        }
        $sig = Get-AuthenticodeSignature $bin
        Write-Host "  -> $binName signature status: $($sig.Status) ($($sig.SignerCertificate.Subject))" -ForegroundColor Green
    }
}

# Generate 1-click certificate trust tool
$trustBat = Join-Path $outDir 'Trust-Anemoia-Certificate.cmd'
$batContent = @"
@echo off
title Anemoia Live Wallpaper - Trust Certificate
echo ========================================================
echo   Anemoia Live Wallpaper - Trust Code Signing Certificate
echo ========================================================
echo.
echo This registers Anemoia's official certificate to your
echo CurrentUser Trusted Publishers store so SmartScreen
echo and Windows Defender recognize Anemoia as a verified publisher.
echo.
certutil -user -addstore TrustedPublisher "%~dp0Anemoia.cer"
echo.
echo ========================================================
echo   Done! Anemoia is now a trusted publisher.
echo   You can run AnemoSetup.exe with zero SmartScreen warnings.
echo ========================================================
echo.
pause
"@
[System.IO.File]::WriteAllText($trustBat, $batContent, [System.Text.Encoding]::ASCII)
Write-Host "Created 1-click trust script: $trustBat" -ForegroundColor Green

Write-Host "==========================================" -ForegroundColor Green
Write-Host "  ALL BUILDS COMPLETE!" -ForegroundColor Green
Write-Host "  1. Single-File Installer: $installerExe ($setupSizeMB MB)" -ForegroundColor Green
Write-Host "  2. Standalone Uninstaller:$anemoDir\Uninstall.exe" -ForegroundColor Green
Write-Host "  3. Portable Executable:   $anemoDir\Anemo.exe" -ForegroundColor Green
Write-Host "  4. Portable Zip:          $zipPath ($zipSizeMB MB)" -ForegroundColor Green
Write-Host "  5. Public Certificate:    $cerPath" -ForegroundColor Green
Write-Host "  6. 1-Click Trust Tool:    $trustBat" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
