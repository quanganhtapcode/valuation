# Deploy Script - Run from PROJECT ROOT (c:\Users\PC\Downloads\Valuation)
# Usage: .\automation\deploy.ps1 [-CommitMessage "your message"]

param(
    [string]$CommitMessage = "Quick deploy update",
    [switch]$IncludeDatabase,
    [string]$DatabaseFile = "stocks_optimized.new.db",
    # Deprecated: frontend is hosted on Vercel from GitHub; this flag is ignored.
    [switch]$IncludeFrontend,
    # Skip the local pre-deploy test suite (not recommended)
    [switch]$SkipTests,
    # Skip latency benchmark performance gate (not recommended)
    [switch]$SkipPerfGate,
    # Benchmark target and strictness knobs
    [string]$PerfBaseUrl = "https://api.quanganh.org/v1/valuation",
    [int]$PerfRuns = 6,
    [int]$PerfWarmup = 1,
    [int]$PerfWorkers = 1,
    [string]$PerfSymbols = "VCB,FPT,MBB",
    [double]$PerfP95HardLimitMs = 300,
    [double]$PerfP99HardLimitMs = 600,
    [double]$PerfMaxErrorRatePct = 1,
    [double]$PerfMaxDegradationPct = 25,
    # Perf profile: auto | production | staging | local | custom
    [ValidateSet("auto", "production", "staging", "local", "custom")]
    [string]$PerfProfile = "auto",
    # Disable Telegram deploy notifications
    [switch]$SkipTelegramNotify
)

# Configuration
$VPSHost = "root@203.55.176.10"
$VPSPath = "/var/www/valuation"

# Get project root (parent of automation folder if running from there)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Change to project root
Push-Location $ProjectRoot
Write-Host "Working directory: $ProjectRoot" -ForegroundColor Gray

function Resolve-PythonExe {
    param([string]$Root)
    $venvWin = Join-Path $Root ".venv\Scripts\python.exe"
    if (Test-Path $venvWin) { return $venvWin }
    $venvUnix = Join-Path $Root ".venv\bin\python3"
    if (Test-Path $venvUnix) { return $venvUnix }
    $pyCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pyCmd) { return "python" }
    return $null
}

function Get-LatestBenchmarkReport {
    param([string]$Root)
    $perfDir = Join-Path $Root "logs\perf"
    if (-not (Test-Path $perfDir)) { return $null }
    $latest = Get-ChildItem -Path $perfDir -Filter "benchmark_hot_endpoints_*.json" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if ($latest) { return $latest.FullName }
    return $null
}

function Get-BenchmarkSummary {
    param([string]$ReportPath)
    if (-not $ReportPath -or -not (Test-Path $ReportPath)) { return $null }
    try {
        $raw = Get-Content $ReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $overall = $raw.overall
        return @{
            Path = $ReportPath
            P50 = [double]($overall.p50_ms)
            P95 = [double]($overall.p95_ms)
            P99 = [double]($overall.p99_ms)
            ErrorRate = [double]($overall.error_rate_pct)
            Status = [string]($overall.status)
        }
    } catch {
        return $null
    }
}

function Invoke-PerfBenchmark {
    param(
        [string]$Phase,
        [string]$PythonExe,
        [string]$BenchmarkScript,
        [string]$Root
    )

    $before = Get-LatestBenchmarkReport -Root $Root
    Write-Host "Running benchmark ($Phase): base=$PerfBaseUrl runs=$PerfRuns warmup=$PerfWarmup workers=$PerfWorkers symbols=$PerfSymbols" -ForegroundColor Yellow

    # Stream benchmark console output directly so this function only returns the report path.
    & $PythonExe $BenchmarkScript --base-url $PerfBaseUrl --api-prefix auto --runs $PerfRuns --warmup $PerfWarmup --workers $PerfWorkers --symbols $PerfSymbols --include-health | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Benchmark failed during $Phase"
    }

    $after = Get-LatestBenchmarkReport -Root $Root
    if (-not $after) {
        throw "Benchmark report not found after $Phase"
    }

    $summary = Get-BenchmarkSummary -ReportPath $after
    if ($summary) {
        Write-Host "Benchmark $Phase => p95=$($summary.P95)ms p99=$($summary.P99)ms err=$($summary.ErrorRate)% status=$($summary.Status)" -ForegroundColor Gray
    }

    if ($before -and ($before -eq $after)) {
        Write-Host "[WARN] Benchmark report file did not rotate between runs: $after" -ForegroundColor Yellow
    }
    return $after
}

function Compare-BenchmarkReports {
    param(
        [string]$BaselinePath,
        [string]$PostPath
    )

    $base = Get-BenchmarkSummary -ReportPath $BaselinePath
    $post = Get-BenchmarkSummary -ReportPath $PostPath
    if (-not $base -or -not $post) {
        return @{
            Pass = $false
            Reason = "Missing benchmark summary (baseline or post-deploy)"
            Reasons = @("Missing benchmark summary (baseline or post-deploy)")
            Base = $base
            Post = $post
            P95DeltaPct = 0
            P99DeltaPct = 0
        }
    }

    $p95DeltaPct = if ($base.P95 -gt 0) { (($post.P95 - $base.P95) / $base.P95) * 100 } else { 0 }
    $p99DeltaPct = if ($base.P99 -gt 0) { (($post.P99 - $base.P99) / $base.P99) * 100 } else { 0 }

    $reasons = @()
    if ($post.ErrorRate -gt $PerfMaxErrorRatePct) {
        $reasons += "error_rate $($post.ErrorRate)% > $PerfMaxErrorRatePct%"
    }
    if ($post.P95 -gt $PerfP95HardLimitMs) {
        $reasons += "p95 $($post.P95)ms > $PerfP95HardLimitMs ms"
    }
    if ($post.P99 -gt $PerfP99HardLimitMs) {
        $reasons += "p99 $($post.P99)ms > $PerfP99HardLimitMs ms"
    }
    if ($base.P95 -gt 0 -and $p95DeltaPct -gt $PerfMaxDegradationPct) {
        $reasons += "p95 degraded $([math]::Round($p95DeltaPct,2))% > $PerfMaxDegradationPct%"
    }
    if ($base.P99 -gt 0 -and $p99DeltaPct -gt $PerfMaxDegradationPct) {
        $reasons += "p99 degraded $([math]::Round($p99DeltaPct,2))% > $PerfMaxDegradationPct%"
    }

    return @{
        Pass = ($reasons.Count -eq 0)
        Base = $base
        Post = $post
        P95DeltaPct = [math]::Round($p95DeltaPct, 2)
        P99DeltaPct = [math]::Round($p99DeltaPct, 2)
        Reasons = $reasons
    }
}

function Resolve-PerfProfile {
    param([string]$ProfileValue, [string]$BaseUrl)
    $p = if ($null -ne $ProfileValue -and "$ProfileValue" -ne "") { "$ProfileValue".ToLowerInvariant() } else { "auto" }
    if ($p -ne "auto") { return $p }

    $u = if ($null -ne $BaseUrl) { "$BaseUrl".ToLowerInvariant() } else { "" }
    if ($u -match "api\.quanganh\.org") { return "production" }
    if ($u -match "127\.0\.0\.1|localhost") { return "local" }
    return "staging"
}

function Set-PerfDefault {
    param([string]$Name, [object]$Value)
    if (-not $script:PSBoundParameters.ContainsKey($Name)) {
        Set-Variable -Name $Name -Value $Value -Scope Script
    }
}

function Apply-PerfProfileDefaults {
    param([string]$ResolvedProfile)

    switch ($ResolvedProfile) {
        "production" {
            Set-PerfDefault -Name "PerfRuns" -Value 10
            Set-PerfDefault -Name "PerfWarmup" -Value 2
            Set-PerfDefault -Name "PerfWorkers" -Value 1
            Set-PerfDefault -Name "PerfSymbols" -Value "VCB,FPT,MBB,HPG"
            Set-PerfDefault -Name "PerfP95HardLimitMs" -Value 280
            Set-PerfDefault -Name "PerfP99HardLimitMs" -Value 550
            Set-PerfDefault -Name "PerfMaxErrorRatePct" -Value 1
            Set-PerfDefault -Name "PerfMaxDegradationPct" -Value 20
        }
        "staging" {
            Set-PerfDefault -Name "PerfRuns" -Value 8
            Set-PerfDefault -Name "PerfWarmup" -Value 1
            Set-PerfDefault -Name "PerfWorkers" -Value 1
            Set-PerfDefault -Name "PerfSymbols" -Value "VCB,FPT,MBB"
            Set-PerfDefault -Name "PerfP95HardLimitMs" -Value 340
            Set-PerfDefault -Name "PerfP99HardLimitMs" -Value 700
            Set-PerfDefault -Name "PerfMaxErrorRatePct" -Value 2
            Set-PerfDefault -Name "PerfMaxDegradationPct" -Value 35
        }
        "local" {
            Set-PerfDefault -Name "PerfRuns" -Value 4
            Set-PerfDefault -Name "PerfWarmup" -Value 1
            Set-PerfDefault -Name "PerfWorkers" -Value 1
            Set-PerfDefault -Name "PerfSymbols" -Value "VCB"
            Set-PerfDefault -Name "PerfP95HardLimitMs" -Value 500
            Set-PerfDefault -Name "PerfP99HardLimitMs" -Value 900
            Set-PerfDefault -Name "PerfMaxErrorRatePct" -Value 5
            Set-PerfDefault -Name "PerfMaxDegradationPct" -Value 50
        }
        default {
            # custom profile keeps caller-provided values unchanged.
        }
    }
}

function Write-DeployPerfHistory {
    param(
        [string]$Root,
        [string]$Outcome,
        [string]$ResolvedProfile,
        [string]$BaselinePath,
        [string]$PostPath,
        [hashtable]$CompareResult,
        [string]$Message
    )

    try {
        $perfDir = Join-Path $Root "logs\perf"
        New-Item -ItemType Directory -Force -Path $perfDir | Out-Null
        $historyPath = Join-Path $perfDir "deploy_perf_history.jsonl"

        $gitRev = ""
        try {
            $gitRev = (git rev-parse --short HEAD 2>$null).Trim()
        } catch {
            $gitRev = ""
        }

        $entry = @{
            timestamp_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            outcome = $Outcome
            message = $Message
            commit = $gitRev
            profile = $ResolvedProfile
            base_url = $PerfBaseUrl
            runs = $PerfRuns
            warmup = $PerfWarmup
            workers = $PerfWorkers
            symbols = $PerfSymbols
            thresholds = @{
                p95_hard_limit_ms = $PerfP95HardLimitMs
                p99_hard_limit_ms = $PerfP99HardLimitMs
                max_error_rate_pct = $PerfMaxErrorRatePct
                max_degradation_pct = $PerfMaxDegradationPct
            }
            baseline_report = $BaselinePath
            post_report = $PostPath
            compare = $CompareResult
        }

        $line = ($entry | ConvertTo-Json -Depth 6 -Compress)
        Add-Content -Path $historyPath -Value $line -Encoding UTF8
        Write-Host "Perf history appended: $historyPath" -ForegroundColor Gray
    } catch {
        Write-Host "[WARN] Failed to write deploy perf history: $_" -ForegroundColor Yellow
    }
}

function Send-DeployTelegramNotification {
    param(
        [string]$SshKey,
        [string]$SshHost,
        [string]$RemoteRoot,
        [string]$Title,
        [string]$Body
    )

    if ($SkipTelegramNotify) {
        return
    }
    if (-not $SshKey -or -not $SshHost -or -not $RemoteRoot) {
        return
    }

    $message = "$Title`n$Body"
    $remoteScript = "${RemoteRoot}/scripts/send_telegram_message.sh"
    $envFile = "${RemoteRoot}/.telegram_uptime.env"
    $remoteCmd = "if [ -x '$remoteScript' ]; then '$remoteScript' --env-file '$envFile' || true; fi"

    try {
        $message | ssh -i $SshKey $SshHost $remoteCmd 1>$null
        Write-Host "Telegram notification attempted" -ForegroundColor Gray
    } catch {
        Write-Host "[WARN] Telegram notification skipped: $_" -ForegroundColor Yellow
    }
}

function Stop-DeployWithNotification {
    param(
        [string]$SshKey,
        [string]$Reason,
        [string]$Body
    )

    Send-DeployTelegramNotification -SshKey $SshKey -SshHost $VPSHost -RemoteRoot $VPSPath -Title "[DEPLOY FAIL] $Reason" -Body $Body
    exit 1
}

try {
    # Prefer Windows-native OpenSSH over the Git-bundled version (which has libcrypto compat issues)
    $WinSSHDir = "C:\Windows\System32\OpenSSH"
    if (Test-Path $WinSSHDir) { $env:PATH = "$WinSSHDir;$env:PATH" }

    $BenchmarkScript = Join-Path $ProjectRoot "benchmark_hot_endpoints.py"
    $PythonExe = Resolve-PythonExe -Root $ProjectRoot
    $PerfGateEnabled = -not $SkipPerfGate
    $BaselineReport = $null
    $PostReport = $null
    $PerfCompare = $null
    $ResolvedPerfProfile = Resolve-PerfProfile -ProfileValue $PerfProfile -BaseUrl $PerfBaseUrl
    Apply-PerfProfileDefaults -ResolvedProfile $ResolvedPerfProfile

    # Check SSH Key Path
    $KeyPaths = @(
        "$HOME\Desktop\key.pem",
        "$HOME\Downloads\key.pem"
    )
    $SSHKey = $null
    foreach ($path in $KeyPaths) {
        if (Test-Path $path) {
            $SSHKey = $path
            break
        }
    }
    
    if (-not $SSHKey) {
        Write-Host " [FAIL] SSH Key not found in Desktop or Downloads!" -ForegroundColor Red
        Write-Host "[WARN] Telegram notify unavailable (missing SSH key)." -ForegroundColor Yellow
        exit 1
    }
    Write-Host " Using Key: $SSHKey" -ForegroundColor Gray

    # ========================================
    # 0. PRE-DEPLOY: LOCAL TESTS
    # ========================================
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   0. PRE-DEPLOY TESTS" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    if ($SkipTests) {
        Write-Host "[WARN] -SkipTests specified  -  skipping local test suite." -ForegroundColor Yellow
    } else {
        $testScript = Join-Path $ProjectRoot "scripts\test_local.ps1"
        if (Test-Path $testScript) {
            Write-Host "Running local test suite (Quick mode)..." -ForegroundColor Yellow
            & $testScript -Quick
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[FAIL] Pre-deploy tests failed. Fix errors before deploying." -ForegroundColor Red
                Write-Host "       To bypass (not recommended): use -SkipTests flag" -ForegroundColor Yellow
                Stop-DeployWithNotification -SshKey $SSHKey -Reason "pre-deploy tests" -Body "CommitMessage=$CommitMessage`nUse -SkipTests to bypass (not recommended)."
            }
            Write-Host "[OK] Pre-deploy tests passed" -ForegroundColor Green
        } else {
            Write-Host "[WARN] Test script not found at $testScript  -  skipping." -ForegroundColor Yellow
        }
    }

    # ========================================
    # 0.5 PRE-DEPLOY PERFORMANCE BASELINE
    # ========================================
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   0.5 PRE-DEPLOY PERFORMANCE BASELINE" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    if ($PerfGateEnabled) {
        if (-not $PythonExe) {
            Write-Host "[WARN] Python not found, skipping performance gate." -ForegroundColor Yellow
            $PerfGateEnabled = $false
        } elseif (-not (Test-Path $BenchmarkScript)) {
            Write-Host "[WARN] Benchmark script not found at $BenchmarkScript  -  skipping performance gate." -ForegroundColor Yellow
            $PerfGateEnabled = $false
        } else {
            Write-Host "Perf profile: $ResolvedPerfProfile" -ForegroundColor Gray
            Write-Host "Perf thresholds: p95<=$PerfP95HardLimitMs p99<=$PerfP99HardLimitMs err<=$PerfMaxErrorRatePct% degrade<=$PerfMaxDegradationPct%" -ForegroundColor Gray
            try {
                $BaselineReport = Invoke-PerfBenchmark -Phase "pre-deploy" -PythonExe $PythonExe -BenchmarkScript $BenchmarkScript -Root $ProjectRoot
                Write-Host "[OK] Pre-deploy benchmark completed: $BaselineReport" -ForegroundColor Green
            } catch {
                Write-Host "[FAIL] Pre-deploy benchmark failed: $_" -ForegroundColor Red
                Write-DeployPerfHistory -Root $ProjectRoot -Outcome "failed" -ResolvedProfile $ResolvedPerfProfile -BaselinePath $BaselineReport -PostPath $PostReport -CompareResult @{} -Message "pre-deploy benchmark failed"
                Send-DeployTelegramNotification -SshKey $SSHKey -SshHost $VPSHost -RemoteRoot $VPSPath -Title "[DEPLOY FAIL] pre-deploy benchmark" -Body "Profile=$ResolvedPerfProfile`nBaseUrl=$PerfBaseUrl`nCommitMessage=$CommitMessage"
                Write-Host "       To bypass (not recommended): use -SkipPerfGate" -ForegroundColor Yellow
                exit 1
            }
        }
    } else {
        Write-Host "[WARN] -SkipPerfGate specified  -  skipping benchmark gate." -ForegroundColor Yellow
    }

    # ========================================
    # 1. GITHUB DEPLOYMENT
    # ========================================
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   1. GITHUB DEPLOYMENT" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    # Check for changes
    $gitStatus = git status --porcelain 2>&1
    if ($gitStatus) {
        Write-Host "Changes detected:" -ForegroundColor Yellow
        git status --short
        Write-Host ""
        
        # Add all tracked and new files
        git add .
        
        $staged = git diff --cached --name-only
        if ($staged) {
            git commit -m $CommitMessage
            git push origin main
        }
    }
    else {
        Write-Host "No changes to commit." -ForegroundColor Yellow
    }

    # ========================================
    # 2. VPS DEPLOYMENT
    # ========================================
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   2. VPS DEPLOYMENT ($VPSHost)" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    # Create temp directory for cleanup
    $TempDeploy = Join-Path $env:TEMP "ValuationDeploy_$(Get-Random)"
    New-Item -ItemType Directory -Force -Path $TempDeploy | Out-Null
    Write-Host "Preparing clean sync in: $TempDeploy" -ForegroundColor Gray

    if ($IncludeFrontend) {
        Write-Host "[WARN] -IncludeFrontend is deprecated and ignored. Frontend is deployed by Vercel from GitHub." -ForegroundColor Yellow
    }

    # Function to copy and clean
    function Sync-Folder {
        param([string]$FolderName, [string]$DestName = $FolderName)
        Write-Host "Preparing $FolderName..." -ForegroundColor Yellow
        $FolderTemp = Join-Path $TempDeploy $DestName
        Copy-Item -Path $FolderName -Destination $FolderTemp -Recurse -Force
        
        # Exclusions List
        $ExcludePatterns = @(
            "node_modules", ".next", ".git", ".vscode",
            "__pycache__", "*.pyc", "*.db", "*.sqlite", "*.log",
            "*test*", "ticker_data.json", ".env"
            # NOTE: do NOT add "*check*"  -  it would remove check_index_api_vps.sh etc.
            # NOTE: *.sqlite excluded so local fetch_sqlite/ DBs never overwrite live VPS data
        )
        
        foreach ($pattern in $ExcludePatterns) {
            Get-ChildItem -Path $FolderTemp -Filter $pattern -Recurse -ErrorAction SilentlyContinue | 
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        }

        # Upload
        scp -i $SSHKey -r $FolderTemp "${VPSHost}:${VPSPath}/"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] Failed to sync $FolderName" -ForegroundColor Red
            return $false
        }
        Write-Host "[OK] $FolderName synced" -ForegroundColor Green
        return $true
    }

    # Sync folders
    if (-not (Sync-Folder "backend")) { Stop-DeployWithNotification -SshKey $SSHKey -Reason "sync backend" -Body "Failed to sync backend folder to ${VPSHost}:${VPSPath}" }
    if (-not (Sync-Folder "automation")) { Stop-DeployWithNotification -SshKey $SSHKey -Reason "sync automation" -Body "Failed to sync automation folder to ${VPSHost}:${VPSPath}" }
    if (-not (Sync-Folder "fetch_sqlite")) { Stop-DeployWithNotification -SshKey $SSHKey -Reason "sync fetch_sqlite" -Body "Failed to sync fetch_sqlite folder to ${VPSHost}:${VPSPath}" }
    Write-Host "Skipping frontend-next sync (frontend is deployed via Vercel from GitHub)" -ForegroundColor Gray
    if (-not (Sync-Folder "scripts")) { Stop-DeployWithNotification -SshKey $SSHKey -Reason "sync scripts" -Body "Failed to sync scripts folder to ${VPSHost}:${VPSPath}" }

    # Sync root files selectively
    Write-Host "Syncing root configs..." -ForegroundColor Yellow
    scp -i $SSHKey package.json requirements.txt run_pipeline.py symbols.txt MAINTENANCE_GUIDE.md README.md "${VPSHost}:${VPSPath}/" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Failed to sync root config files" -ForegroundColor Red
        Stop-DeployWithNotification -SshKey $SSHKey -Reason "sync root files" -Body "scp root configs failed for ${VPSHost}:${VPSPath}"
    }

    # Optional: Upload optimized SQLite DB (kept out of default sync to avoid huge transfers)
    if ($IncludeDatabase) {
        $DbPath = Join-Path $ProjectRoot $DatabaseFile
        if (-not (Test-Path $DbPath)) {
            Write-Host " [FAIL] Database file not found: $DbPath" -ForegroundColor Red
            Stop-DeployWithNotification -SshKey $SSHKey -Reason "database missing" -Body "Requested DB file not found: $DbPath"
        }

        Write-Host "Uploading DB: $DatabaseFile -> ${VPSPath}/stocks_optimized.db" -ForegroundColor Yellow
        # Upload to a temp name then move atomically on VPS
        scp -i $SSHKey $DbPath "${VPSHost}:${VPSPath}/stocks_optimized.db.upload"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] Failed to upload DB" -ForegroundColor Red
            Stop-DeployWithNotification -SshKey $SSHKey -Reason "database upload" -Body "Failed to upload DB file $DatabaseFile"
        }
        ssh -i $SSHKey $VPSHost "mv -f ${VPSPath}/stocks_optimized.db.upload ${VPSPath}/stocks_optimized.db"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] Failed to finalize DB replace on VPS" -ForegroundColor Red
            Stop-DeployWithNotification -SshKey $SSHKey -Reason "database finalize" -Body "Failed to move uploaded DB into place on VPS"
        }
    }

    # Cleanup VPS: Remove old .pyc and __pycache__ that might exist from previous deploys
    Write-Host "Cleaning up old cache files on VPS..." -ForegroundColor Yellow
    ssh -i $SSHKey $VPSHost "find ${VPSPath} -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null"
    ssh -i $SSHKey $VPSHost "find ${VPSPath} -name '*.pyc' -delete 2>/dev/null"

    # Fix line endings on shell scripts (Windows CRLF -> Unix LF)
    ssh -i $SSHKey $VPSHost "find ${VPSPath}/scripts ${VPSPath}/automation -name '*.sh' -exec dos2unix {} + 2>/dev/null; chmod +x ${VPSPath}/scripts/*.sh ${VPSPath}/automation/*.sh 2>/dev/null"

    # Re-create compatibility views (needed if DB was replaced, harmless otherwise)
    Write-Host "Re-creating DB compatibility views..." -ForegroundColor Yellow
    ssh -i $SSHKey $VPSHost "cd ${VPSPath} && .venv/bin/python3 scripts/create_compat_views.py 2>&1"

    # ========================================
    # 3. RESTART SERVICES
    # ========================================
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "   3. RESTART SERVICES" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan

    # Restart Backend
    Write-Host "Restarting valuation (Backend)..." -ForegroundColor Yellow
    ssh -i $SSHKey $VPSHost "systemctl restart valuation"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Failed to restart valuation service" -ForegroundColor Red
        Stop-DeployWithNotification -SshKey $SSHKey -Reason "service restart" -Body "systemctl restart valuation failed"
    }
    
    # Check service status
    Write-Host ""
    Write-Host "Service Status:" -ForegroundColor Yellow
    $status = ssh -i $SSHKey $VPSHost "systemctl is-active valuation"
    if ($status -eq "active") {
        Write-Host "  valuation: $status [OK]" -ForegroundColor Green

        Write-Host ""
        Write-Host "Post-restart smoke checks..." -ForegroundColor Yellow

        # /health
        $healthCode = ssh -i $SSHKey $VPSHost "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health"
        if ($healthCode -ne "200") {
            Write-Host "  /health failed (HTTP $healthCode) [FAIL]" -ForegroundColor Red
            ssh -i $SSHKey $VPSHost "journalctl -u valuation -n 120 --no-pager"
            Stop-DeployWithNotification -SshKey $SSHKey -Reason "health check" -Body "/health returned HTTP $healthCode after deploy"
        }
        Write-Host "  /health: 200 [OK]" -ForegroundColor Green

        # /api/market/vci-indices
        $indicesCode = ssh -i $SSHKey $VPSHost "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/market/vci-indices"
        if ($indicesCode -ne "200") {
            Write-Host "  /api/market/vci-indices failed (HTTP $indicesCode) [FAIL]" -ForegroundColor Red
            ssh -i $SSHKey $VPSHost "journalctl -u valuation -n 120 --no-pager"
            Stop-DeployWithNotification -SshKey $SSHKey -Reason "smoke market indices" -Body "/api/market/vci-indices returned HTTP $indicesCode"
        }
        Write-Host "  /api/market/vci-indices: 200 [OK]" -ForegroundColor Green

        # /api/stock/VCB
        $stockCode = ssh -i $SSHKey $VPSHost "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/stock/VCB"
        Write-Host "  /api/stock/VCB: $stockCode$(if ($stockCode -eq '200') { ' [OK]' } else { ' [FAIL]' })" -ForegroundColor $(if ($stockCode -eq '200') { 'Green' } else { 'Red' })

        # ========================================
        # 4. POST-DEPLOY PERFORMANCE GATE
        # ========================================
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host "   4. POST-DEPLOY PERFORMANCE GATE" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan

        if ($PerfGateEnabled) {
            try {
                $PostReport = Invoke-PerfBenchmark -Phase "post-deploy" -PythonExe $PythonExe -BenchmarkScript $BenchmarkScript -Root $ProjectRoot
                Write-Host "[OK] Post-deploy benchmark completed: $PostReport" -ForegroundColor Green
            } catch {
                Write-Host "[FAIL] Post-deploy benchmark failed: $_" -ForegroundColor Red
                Write-DeployPerfHistory -Root $ProjectRoot -Outcome "failed" -ResolvedProfile $ResolvedPerfProfile -BaselinePath $BaselineReport -PostPath $PostReport -CompareResult @{} -Message "post-deploy benchmark failed"
                Send-DeployTelegramNotification -SshKey $SSHKey -SshHost $VPSHost -RemoteRoot $VPSPath -Title "[DEPLOY FAIL] post-deploy benchmark" -Body "Profile=$ResolvedPerfProfile`nBaseUrl=$PerfBaseUrl`nBaseline=$BaselineReport`nPost=$PostReport"
                exit 1
            }

            if ($BaselineReport -and $PostReport) {
                $cmp = Compare-BenchmarkReports -BaselinePath $BaselineReport -PostPath $PostReport
                $PerfCompare = $cmp

                if ($cmp.Base -and $cmp.Post) {
                    Write-Host "Baseline: p95=$($cmp.Base.P95)ms p99=$($cmp.Base.P99)ms err=$($cmp.Base.ErrorRate)%" -ForegroundColor Gray
                    Write-Host "Post    : p95=$($cmp.Post.P95)ms p99=$($cmp.Post.P99)ms err=$($cmp.Post.ErrorRate)%" -ForegroundColor Gray
                    Write-Host "Delta   : p95=$($cmp.P95DeltaPct)% p99=$($cmp.P99DeltaPct)%" -ForegroundColor Gray
                }

                if (-not $cmp.Pass) {
                    Write-Host "[FAIL] Performance gate failed:" -ForegroundColor Red
                    foreach ($reason in $cmp.Reasons) {
                        Write-Host "  - $reason" -ForegroundColor Red
                    }
                    Write-DeployPerfHistory -Root $ProjectRoot -Outcome "failed" -ResolvedProfile $ResolvedPerfProfile -BaselinePath $BaselineReport -PostPath $PostReport -CompareResult $cmp -Message "performance gate failed"
                    $reasonText = ($cmp.Reasons -join "; ")
                    Send-DeployTelegramNotification -SshKey $SSHKey -SshHost $VPSHost -RemoteRoot $VPSPath -Title "[DEPLOY FAIL] performance gate" -Body "Profile=$ResolvedPerfProfile`nP95Delta=$($cmp.P95DeltaPct)% P99Delta=$($cmp.P99DeltaPct)%`nReasons=$reasonText"
                    Write-Host "Deployment stopped to protect website latency SLO." -ForegroundColor Red
                    exit 1
                }

                Write-Host "[OK] Performance gate passed" -ForegroundColor Green
                Write-DeployPerfHistory -Root $ProjectRoot -Outcome "passed" -ResolvedProfile $ResolvedPerfProfile -BaselinePath $BaselineReport -PostPath $PostReport -CompareResult $cmp -Message "performance gate passed"
            }
        } else {
            Write-Host "Performance gate skipped" -ForegroundColor Yellow
            Write-DeployPerfHistory -Root $ProjectRoot -Outcome "skipped" -ResolvedProfile $ResolvedPerfProfile -BaselinePath $BaselineReport -PostPath $PostReport -CompareResult @{} -Message "performance gate skipped"
        }
    }
    else {
        Write-Host "  valuation: $status [FAIL]" -ForegroundColor Red
        ssh -i $SSHKey $VPSHost "journalctl -u valuation -n 120 --no-pager"
        Stop-DeployWithNotification -SshKey $SSHKey -Reason "service inactive" -Body "valuation service status after restart: $status"
    }
    
    Write-Host ""
    Write-Host "DEPLOYMENT COMPLETE!" -ForegroundColor Green
    Write-Host "Backend updated for Vercel consumption." -ForegroundColor Gray

    if ($PerfGateEnabled -and $PerfCompare -and $PerfCompare.Post) {
        Send-DeployTelegramNotification -SshKey $SSHKey -SshHost $VPSHost -RemoteRoot $VPSPath -Title "[DEPLOY PASS] valuation" -Body "Profile=$ResolvedPerfProfile`nPost p95=$($PerfCompare.Post.P95)ms p99=$($PerfCompare.Post.P99)ms err=$($PerfCompare.Post.ErrorRate)%`nDelta p95=$($PerfCompare.P95DeltaPct)% p99=$($PerfCompare.P99DeltaPct)%"
    } else {
        Send-DeployTelegramNotification -SshKey $SSHKey -SshHost $VPSHost -RemoteRoot $VPSPath -Title "[DEPLOY PASS] valuation" -Body "Profile=$ResolvedPerfProfile`nPerfGate=$(if($PerfGateEnabled){'enabled'}else{'skipped'})"
    }

    # Cleanup local temp
    Remove-Item $TempDeploy -Recurse -Force -ErrorAction SilentlyContinue
}
catch {
    Send-DeployTelegramNotification -SshKey $SSHKey -SshHost $VPSHost -RemoteRoot $VPSPath -Title "[DEPLOY FAIL] valuation" -Body "Unhandled error: $_"
    Write-Host "[ERROR] Deployment failed: $_" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
