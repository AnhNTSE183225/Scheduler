# ==============================================================================
# PulsePlan Scheduler — Cloudflare Pages Direct Deploy (PowerShell / Windows)
# ==============================================================================
# Builds the production SolidJS bundle locally and deploys frontend/dist directly
# via Wrangler, avoiding GitHub Actions runner usage/costs.
#
# Usage:
#   .\deploy-frontend.ps1             # Build & deploy to Cloudflare Pages (no params needed)
#   .\deploy-frontend.ps1 -SkipChecks
#   .\deploy-frontend.ps1 -DryRun     # Typecheck + build + auth check without uploading
#
# Authentication (either method works):
#   1. Interactive OAuth (recommended locally): run `npx wrangler login` once.
#      (deploy-frontend.ps1 will launch `wrangler login` automatically if needed.)
#   2. API Token: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in your
#      environment, `.env`, or `.env.deploy` (also supports VITE_API_BASE there).
# ==============================================================================

param(
    [string]$ProjectName = "",
    [string]$Branch = "main",
    [string]$Profile = "PROD",
    [string]$ApiBase = "",
    [switch]$SkipChecks,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $root "frontend"
$distDir = Join-Path $frontendDir "dist"

function Get-PkgManager {
    $pnpm = Get-Command pnpm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pnpm) { return @{ Exe = $pnpm.Source; Name = "pnpm" } }
    $npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($npm) { return @{ Exe = $npm.Source; Name = "npm" } }
    throw "Neither pnpm nor npm was found in PATH. Please install Node.js."
}

function Get-WranglerInvocation {
    $localWrangler = Join-Path $frontendDir "node_modules\.bin\wrangler.cmd"
    if (Test-Path $localWrangler) {
        return @{ Exe = $localWrangler; PrefixArgs = @() }
    }
    throw "Local wrangler was not found at $localWrangler. Run 'pnpm install' in frontend/."
}

function Invoke-WranglerStreaming {
    param([string[]]$WranglerArgs)
    $inv = Get-WranglerInvocation
    $allArgs = $inv.PrefixArgs + $WranglerArgs
    & $inv.Exe @allArgs | Out-Host
    return $LASTEXITCODE
}

function Import-DeployEnv {
    $allowedKeys = @("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "VITE_API_BASE")
    foreach ($dir in @($root, $frontendDir)) {
        foreach ($fileName in @(".env", ".env.deploy", ".env.production")) {
            $envFile = Join-Path $dir $fileName
            if (-not (Test-Path $envFile)) { continue }

            foreach ($line in (Get-Content $envFile -Encoding UTF8)) {
                $trimmed = $line.Trim()
                if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
                if ($trimmed -match '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
                    $key = $matches[1]
                    if ($allowedKeys -notcontains $key) { continue }
                    if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key))) { continue }

                    $rawVal = $matches[2].Trim()
                    if ($rawVal -match '^"(.*)"(\s+#.*)?$') {
                        $val = $matches[1]
                    } elseif ($rawVal -match "^'(.*)'(\s+#.*)?$") {
                        $val = $matches[1]
                    } else {
                        $val = ($rawVal -replace '\s+#.*$', '').Trim()
                    }
                    if ($val) {
                        [Environment]::SetEnvironmentVariable($key, $val, "Process")
                    }
                }
            }
        }
    }
}

function Read-YamlConfigValue {
    param([string]$FilePath, [string]$Key)
    if (-not (Test-Path $FilePath)) { return "" }
    foreach ($line in (Get-Content $FilePath -Encoding UTF8)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        if ($trimmed -match "^${Key}:\s*(.*)$") {
            $raw = $matches[1].Trim()
            if ($raw -match '^"(.*)"(\s+#.*)?$') { return $matches[1] }
            if ($raw -match "^'(.*)'(\s+#.*)?$") { return $matches[1] }
            return ($raw -replace '\s+#.*$', '').Trim()
        }
    }
    return ""
}

$pkgManager = Get-PkgManager
Import-DeployEnv

$cfgDir = Join-Path $frontendDir "config"
$defaultCfgPath = Join-Path $cfgDir "default.yaml"
$prodCfgPath = Join-Path $cfgDir "prod.yaml"
if (-not (Test-Path $defaultCfgPath)) {
    throw "Missing frontend config file: $defaultCfgPath"
}

$cfgProject = Read-YamlConfigValue -FilePath $defaultCfgPath -Key "pages_project"
$cfgApiUrl  = Read-YamlConfigValue -FilePath $defaultCfgPath -Key "api_url"

if ($Profile.ToUpper() -eq "PROD" -and (Test-Path $prodCfgPath)) {
    $prodProject = Read-YamlConfigValue -FilePath $prodCfgPath -Key "pages_project"
    $prodApiUrl  = Read-YamlConfigValue -FilePath $prodCfgPath -Key "api_url"
    if ($prodProject) { $cfgProject = $prodProject }
    if ($prodApiUrl)  { $cfgApiUrl  = $prodApiUrl }
}

if (-not $ProjectName) { $ProjectName = $cfgProject }
if (-not $ProjectName) { throw "pages_project is not set in $cfgDir and -ProjectName was not provided." }

$effectiveApiBase = if ($ApiBase) {
    $ApiBase.TrimEnd('/')
} elseif ($env:VITE_API_BASE) {
    $env:VITE_API_BASE.TrimEnd('/')
} else {
    $cfgApiUrl.TrimEnd('/')
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "   PulsePlan UI -> Cloudflare Pages Direct Deploy" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Profile  : $Profile (frontend/config)" -ForegroundColor DarkGray
Write-Host "  Project  : $ProjectName" -ForegroundColor DarkGray
Write-Host "  Branch   : $Branch" -ForegroundColor DarkGray
Write-Host "  API Base : $(if ($effectiveApiBase) { $effectiveApiBase } else { '(relative /api — WARNING: set api_url in config.prod.yaml!)' })" -ForegroundColor $(if ($effectiveApiBase) { 'DarkGray' } else { 'Yellow' })
if ($DryRun) {
    Write-Host "  Mode     : DRY RUN (no upload)" -ForegroundColor Yellow
}
Write-Host ""

$sw = [System.Diagnostics.Stopwatch]::StartNew()

# 1. Check / install dependencies if missing
Write-Host "[1/5] Checking frontend dependencies..." -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Push-Location $frontendDir
    try {
        & $pkgManager.Exe install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            & $pkgManager.Exe install
            if ($LASTEXITCODE -ne 0) { throw "$($pkgManager.Name) install failed (exit $LASTEXITCODE)." }
        }
    } finally {
        Pop-Location
    }
}
Write-Host "  OK: Using $($pkgManager.Name)" -ForegroundColor Green

# 2. Verify Cloudflare authentication
Write-Host "[2/5] Checking Cloudflare authentication..." -ForegroundColor Cyan
if (-not [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
    Write-Host "  OK: Using CLOUDFLARE_API_TOKEN from environment." -ForegroundColor Green
} else {
    $inv = Get-WranglerInvocation
    $whoamiArgs = $inv.PrefixArgs + @("whoami")
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $whoamiOut = & $inv.Exe @whoamiArgs 2>&1
    $whoamiCode = $LASTEXITCODE
    $ErrorActionPreference = $prevPref

    $whoamiText = ($whoamiOut | Out-String)
    $isAuthed = ($whoamiCode -eq 0) -and ($whoamiText -notmatch "not authenticated")
    if ($isAuthed) {
        Write-Host "  OK: Wrangler session authenticated." -ForegroundColor Green
    } elseif ($DryRun) {
        Write-Host "  WARN: Wrangler is not logged in yet (dry-run continues; run 'npx wrangler login' before deploying)." -ForegroundColor Yellow
    } else {
        Write-Host "  Not logged into Cloudflare yet. Launching 'wrangler login'..." -ForegroundColor Yellow
        $loginCode = Invoke-WranglerStreaming -WranglerArgs @("login")
        if ($loginCode -ne 0) {
            throw "Cloudflare login failed or was cancelled (exit $loginCode)."
        }
    }
}

# 3. TypeScript check unless skipped
if ($SkipChecks) {
    Write-Host "[3/5] Skipping typecheck (-SkipChecks)." -ForegroundColor Yellow
} else {
    Write-Host "[3/5] Running TypeScript check (tsc --noEmit)..." -ForegroundColor Cyan
    Push-Location $frontendDir
    try {
        & $pkgManager.Exe exec tsc --noEmit
        if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed (exit $LASTEXITCODE). Aborting deploy." }
    } finally {
        Pop-Location
    }
    Write-Host "  OK: TypeScript check passed." -ForegroundColor Green
}

# 4. Build Cloudflare Pages static bundle (frontend/dist/)
Write-Host "[4/5] Building Cloudflare Pages bundle..." -ForegroundColor Cyan
if (Test-Path $distDir) {
    Remove-Item -Recurse -Force $distDir -ErrorAction Stop
}

$oldViteApiBase = $env:VITE_API_BASE
Push-Location $frontendDir
try {
    if ($effectiveApiBase) {
        $env:VITE_API_BASE = $effectiveApiBase
    }
    & $pkgManager.Exe run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed (exit $LASTEXITCODE)." }
} finally {
    $env:VITE_API_BASE = $oldViteApiBase
    Pop-Location
}

if (-not (Test-Path (Join-Path $distDir "index.html"))) {
    throw "Cloudflare Pages build did not produce expected frontend/dist/index.html."
}
Write-Host "  OK: Cloudflare Pages bundle ready in frontend/dist/." -ForegroundColor Green

# 5. Deploy to Cloudflare Pages
if ($DryRun) {
    $sw.Stop()
    Write-Host "[5/5] Dry run complete in $($sw.Elapsed.TotalSeconds.ToString('N1'))s — skipped Wrangler upload." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

Write-Host "[5/5] Deploying frontend/dist/ to Cloudflare Pages ($ProjectName / branch: $Branch)..." -ForegroundColor Cyan
Push-Location $frontendDir
try {
    $inv = Get-WranglerInvocation
    $createArgs = $inv.PrefixArgs + @("pages", "project", "create", $ProjectName, "--production-branch", $Branch)
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $inv.Exe @createArgs *> $null
    $ErrorActionPreference = $prevPref

    $deployCode = Invoke-WranglerStreaming -WranglerArgs @("pages", "deploy", "dist", "--project-name", $ProjectName, "--branch", $Branch)
    if ($deployCode -ne 0) {
        throw "Wrangler pages deploy failed (exit $deployCode)."
    }
} finally {
    Pop-Location
}

$sw.Stop()
Write-Host ""
Write-Host ("Deploy succeeded in {0:N1}s!" -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
Write-Host "  URL: https://$ProjectName.pages.dev" -ForegroundColor Cyan
Write-Host ""
exit 0
