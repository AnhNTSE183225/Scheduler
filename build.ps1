# ==============================================================================
# Zero-Assumption Production Build Script (PowerShell / Windows)
# ==============================================================================

param(
    [switch]$Clean,
    [switch]$SkipFrontend,
    [switch]$SkipBackend
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"
$stopScript = Join-Path $root "stop.ps1"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "       ZERO-ASSUMPTION PRODUCTION BUILD PIPELINE (WINDOWS)" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host ""

function Refresh-SessionPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    $env:Path = "$cargoBin;$userPath;$machinePath"
}

function Test-CommandExists {
    param([string]$CommandName)
    $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
    return $null -ne $cmd
}

function Install-ViaWinget {
    param(
        [string]$PackageId,
        [string]$DisplayName,
        [string]$ExtraArgs = ""
    )
    if (-not (Test-CommandExists "winget")) { return $false }
    Write-Host "  [AUTO-INSTALL] Installing $DisplayName ($PackageId) via winget..." -ForegroundColor Yellow
    $argList = "install --id $PackageId --exact --silent --accept-package-agreements --accept-source-agreements $ExtraArgs"
    $proc = Start-Process -FilePath "winget" -ArgumentList $argList -Wait -PassThru -NoNewWindow
    Refresh-SessionPath
    return ($proc.ExitCode -eq 0)
}

function Throw-MissingDependency {
    param(
        [string]$DependencyName,
        [string]$Purpose,
        [string]$DownloadUrl,
        [string]$InstallCommand
    )
    Write-Host ""
    Write-Host "==================================================================" -ForegroundColor Red
    Write-Host " [ERROR] FATAL: MISSING REQUIRED BUILD ENVIRONMENT DEPENDENCY" -ForegroundColor Red
    Write-Host "==================================================================" -ForegroundColor Red
    Write-Host "  Missing Component : $DependencyName" -ForegroundColor Yellow
    Write-Host "  Required For      : $Purpose" -ForegroundColor Gray
    Write-Host "  Download URL      : $DownloadUrl" -ForegroundColor Cyan
    Write-Host "  Manual Command    : $InstallCommand" -ForegroundColor Green
    Write-Host "==================================================================" -ForegroundColor Red
    throw "Build aborted: Missing dependency '$DependencyName'."
}

function Test-MsvcLinkerInstalled {
    if (Test-CommandExists "cl.exe") { return $true }
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vcPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vcPath) { return $true }
    }
    return $false
}

# 0. Pre-Flight Environment & Toolchain Verification Checklist
Write-Host "[Phase 0] Running Zero-Assumption Toolchain & Dependency Checklist..." -ForegroundColor Cyan
Refresh-SessionPath

if (-not (Test-CommandExists "git")) {
    $installed = Install-ViaWinget -PackageId "Git.Git" -DisplayName "Git SCM"
    if (-not $installed -or -not (Test-CommandExists "git")) {
        Throw-MissingDependency -DependencyName "Git" -Purpose "Source control and Cargo dependency fetching" -DownloadUrl "https://git-scm.com/download/win" -InstallCommand "winget install Git.Git"
    }
}
Write-Host "  [OK] Git SCM verified: $(git --version)" -ForegroundColor Green

if (-not $SkipBackend -and (Test-Path $backendDir)) {
    if (-not (Test-MsvcLinkerInstalled)) {
        $installed = Install-ViaWinget -PackageId "Microsoft.VisualStudio.2022.BuildTools" -DisplayName "Visual Studio 2022 C++ Build Tools (MSVC Linker)" -ExtraArgs '--override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"'
        if (-not $installed -or -not (Test-MsvcLinkerInstalled)) {
            Throw-MissingDependency -DependencyName "Visual Studio C++ Build Tools" -Purpose "Linking native Rust binaries on Windows" -DownloadUrl "https://visualstudio.microsoft.com/visual-cpp-build-tools/" -InstallCommand 'winget install Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools"'
        }
    }
    Write-Host "  [OK] MSVC C/C++ Native Linker verified" -ForegroundColor Green

    if (-not (Test-CommandExists "cargo") -or -not (Test-CommandExists "rustc")) {
        $installed = Install-ViaWinget -PackageId "Rustlang.Rustup" -DisplayName "Rust Toolchain (rustup)"
        if ((Test-CommandExists "rustup") -and -not (Test-CommandExists "cargo")) {
            & rustup default stable
            Refresh-SessionPath
        }
        if (-not (Test-CommandExists "cargo") -or -not (Test-CommandExists "rustc")) {
            Throw-MissingDependency -DependencyName "Rust Toolchain" -Purpose "Compiling the Rust backend (--release)" -DownloadUrl "https://rustup.rs/" -InstallCommand "winget install Rustlang.Rustup"
        }
    }
    Write-Host "  [OK] Rust Toolchain verified: $(rustc --version) | $(cargo --version)" -ForegroundColor Green
}

if (-not $SkipFrontend -and (Test-Path $frontendDir)) {
    if (-not (Test-CommandExists "node")) {
        $installed = Install-ViaWinget -PackageId "OpenJS.NodeJS.LTS" -DisplayName "Node.js LTS"
        if (-not $installed -or -not (Test-CommandExists "node")) {
            Throw-MissingDependency -DependencyName "Node.js LTS" -Purpose "Compiling TypeScript and bundling SolidJS/Vite assets" -DownloadUrl "https://nodejs.org/" -InstallCommand "winget install OpenJS.NodeJS.LTS"
        }
    }
    Write-Host "  [OK] Node.js verified: $(node --version)" -ForegroundColor Green

    if (-not (Test-CommandExists "pnpm")) {
        try {
            if (Test-CommandExists "corepack") {
                & corepack enable 2>$null
                & corepack prepare pnpm@latest --activate 2>$null
            }
            if (-not (Test-CommandExists "pnpm") -and (Test-CommandExists "npm")) {
                & npm install -g pnpm
            }
            Refresh-SessionPath
        } catch {}
        if (-not (Test-CommandExists "pnpm")) {
            $installed = Install-ViaWinget -PackageId "pnpm.pnpm" -DisplayName "pnpm Package Manager"
        }
        if (-not (Test-CommandExists "pnpm")) {
            Throw-MissingDependency -DependencyName "pnpm" -Purpose "Frontend dependency locking and asset bundling" -DownloadUrl "https://pnpm.io/installation" -InstallCommand "corepack enable && corepack prepare pnpm@latest --activate"
        }
    }
    Write-Host "  [OK] pnpm verified: v$(pnpm --version)" -ForegroundColor Green
}
Write-Host ""

# 1. Stop Running Services
Write-Host "[Phase 1] Ensuring running services are stopped before compilation..." -ForegroundColor Cyan
if (Test-Path $stopScript) {
    & $stopScript -Quiet
}

# 2. Clean Artifacts (If Requested)
if ($Clean) {
    Write-Host "[Phase 2] Cleaning previous build artifacts..." -ForegroundColor Yellow
    $distDir = Join-Path $frontendDir "dist"
    if (Test-Path $distDir) {
        Remove-Item -Recurse -Force $distDir -ErrorAction SilentlyContinue
    }
}

# 3. Build Frontend
if (-not $SkipFrontend -and (Test-Path $frontendDir)) {
    Write-Host "[Phase 3] Building Frontend (Optimized Production Bundle)..." -ForegroundColor Magenta
    $nodeModules = Join-Path $frontendDir "node_modules"
    if ($Clean -or (-not (Test-Path $nodeModules))) {
        Write-Host "  Installing frontend dependencies via pnpm..." -ForegroundColor Cyan
        Push-Location $frontendDir
        try {
            & pnpm install --frozen-lockfile
            if ($LASTEXITCODE -ne 0) {
                & pnpm install
                if ($LASTEXITCODE -ne 0) { throw "Failed to install frontend dependencies." }
            }
        } finally {
            Pop-Location
        }
    }

    Write-Host "  Compiling TypeScript and bundling SolidJS production assets..." -ForegroundColor Cyan
    Push-Location $frontendDir
    try {
        & pnpm run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }

    $distIndex = Join-Path $frontendDir "dist\index.html"
    if (-not (Test-Path $distIndex)) {
        throw "Frontend build finished, but $distIndex was not generated."
    }
    $distAssets = Get-ChildItem (Join-Path $frontendDir "dist\assets") -File -ErrorAction SilentlyContinue
    $totalKb = ($distAssets | Measure-Object -Property Length -Sum).Sum / 1KB
    Write-Host ("  [OK] Frontend production bundle ready! ({0:N1} KB assets)" -f $totalKb) -ForegroundColor Green
    Write-Host ""
}

# 4. Build Backend
if (-not $SkipBackend -and (Test-Path $backendDir)) {
    Write-Host "[Phase 4] Building Backend (Rust Release Profile: opt-level=3, LTO=fat)..." -ForegroundColor Cyan
    Push-Location $backendDir
    try {
        if ($Clean) {
            & cargo clean
        }
        & cargo build --release
        if ($LASTEXITCODE -ne 0) { throw "Backend release compilation failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }

    $exeCandidates = Get-ChildItem (Join-Path $backendDir "target\release\*.exe") -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '^build-script-' }
    if (-not $exeCandidates) {
        throw "Backend compilation completed, but no release .exe binary was found in $backendDir\target\release\"
    }
    $releaseExe = $exeCandidates | Select-Object -First 1
    $mb = $releaseExe.Length / 1MB
    Write-Host ("  [OK] Backend release binary ready: $($releaseExe.Name) ({0:N2} MB)" -f $mb) -ForegroundColor Green
    Write-Host ""
}

$sw.Stop()
$elapsed = [Math]::Round($sw.Elapsed.TotalSeconds, 1)
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "       PRODUCTION BUILD COMPLETED SUCCESSFULLY IN ${elapsed}s!" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  Observability     : .\observability\install.ps1 (auto-started by .\start.ps1)" -ForegroundColor Cyan
Write-Host "  Start Application : .\start.ps1" -ForegroundColor Yellow
Write-Host "  Stop Application  : .\stop.ps1" -ForegroundColor Yellow
Write-Host ""
