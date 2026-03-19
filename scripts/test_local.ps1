# ===========================================================================
# Local Pre-Deploy Test Suite
# Run this BEFORE deploying to production.
#
# Usage:
#   .\scripts\test_local.ps1            # full suite
#   .\scripts\test_local.ps1 -Quick     # imports + syntax only
#   .\scripts\test_local.ps1 -ApiOnly   # start local server + endpoint tests
# ===========================================================================

param(
    [switch]$Quick,
    [switch]$ApiOnly
)

$ErrorActionPreference = "Stop"
# In PowerShell 7, native commands writing to stderr can become terminating
# errors when ErrorActionPreference=Stop. Keep stderr as non-terminating so
# third-party notices do not break test flow.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $Root

$Python = if (Test-Path (Join-Path $Root ".venv\Scripts\python.exe")) {
    (Join-Path $Root ".venv\Scripts\python.exe")
} elseif (Test-Path (Join-Path $Root ".venv\bin\python3")) {
    (Join-Path $Root ".venv\bin\python3")
} else {
    "python"
}

$Passed = 0
$Failed = 0
$Skipped = 0

function Write-Pass($msg) {
    Write-Host "  [PASS] $msg" -ForegroundColor Green
    $script:Passed++
}

function Write-Fail($msg) {
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
    $script:Failed++
}

function Write-Skip($msg) {
    Write-Host "  [SKIP] $msg" -ForegroundColor Yellow
    $script:Skipped++
}

function Write-Section($title) {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
}

function Test-Endpoint($port, $path, $expectCode, $label) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port$path" -TimeoutSec 10 -ErrorAction Stop
        $code = $r.StatusCode
    } catch {
        $code = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $code = [int]$_.Exception.Response.StatusCode
        }
    }

    if ($code -eq $expectCode) {
        Write-Pass "$code $label"
    } else {
        Write-Fail "Expected $expectCode, got $code - $label"
    }
}

function Test-EndpointAny($port, $path, $expectCodes, $label) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port$path" -TimeoutSec 10 -ErrorAction Stop
        $code = $r.StatusCode
    } catch {
        $code = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $code = [int]$_.Exception.Response.StatusCode
        }
    }

    if ($expectCodes -contains $code) {
        Write-Pass "$code $label"
    } else {
        $expectedText = ($expectCodes -join "/")
        Write-Fail "Expected $expectedText, got $code - $label"
    }
}

function Test-JsonField($port, $path, $field, $label) {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port$path" -TimeoutSec 10
        if ($r.PSObject.Properties.Name -contains $field) {
            Write-Pass "$label has field $field"
        } else {
            Write-Fail "$label missing field $field"
        }
    } catch {
        Write-Fail "$label - $($_.Exception.Message)"
    }
}

try {
    Write-Section "1. ENVIRONMENT"

    if (Test-Path ".env") {
        Write-Pass ".env file present"
        $envContent = Get-Content ".env" -Raw
        foreach ($key in @("VNSTOCK_API_KEY")) {
            if ($envContent -match "$key\s*=\s*\S+") {
                Write-Pass ".env has $key"
            } else {
                Write-Fail ".env missing $key"
            }
        }
        if ($envContent -match "STOCKS_DB_PATH\s*=\s*\S+") {
            Write-Pass ".env has STOCKS_DB_PATH"
        } else {
            Write-Skip ".env missing STOCKS_DB_PATH (optional)"
        }
    } else {
        Write-Fail ".env file missing"
    }

    if (Test-Path $Python) {
        Write-Pass "Python found: $Python"
    } else {
        Write-Fail "Python not found at $Python"
    }

    $dbPath = if ($env:STOCKS_DB_PATH) { $env:STOCKS_DB_PATH } else { Join-Path $Root "vietnam_stocks.db" }
    if (Test-Path $dbPath) {
        $sizeMb = [math]::Round((Get-Item $dbPath).Length / 1MB, 1)
        Write-Pass "DB found: $dbPath ($sizeMb MB)"
    } else {
        Write-Fail "DB not found: $dbPath"
    }

    if (-not $ApiOnly) {
        Write-Section "2. SYNTAX CHECK"

        $pyFiles = Get-ChildItem -Path "backend", "fetch_sqlite", "scripts" -Filter "*.py" -Recurse |
            Where-Object { $_.FullName -notmatch "__pycache__" }
        $pyFiles += Get-Item "run_pipeline.py"

        $syntaxErrors = 0
        foreach ($f in $pyFiles) {
            & $Python -m py_compile $f.FullName 2>$null
            if ($LASTEXITCODE -ne 0) {
                $rel = $f.FullName.Replace($Root + "\", "")
                Write-Fail "Syntax error: $rel"
                $syntaxErrors++
            }
        }
        if ($syntaxErrors -eq 0) {
            Write-Pass "All $($pyFiles.Count) Python files syntax OK"
        }

        Write-Section "3. IMPORT CHECKS"
        $env:PYTHONPATH = $Root
        $modules = @(
            "backend.extensions",
            "backend.updater",
            "backend.services",
            "backend.routes.stock_routes",
            "backend.routes.valuation_routes",
            "backend.routes.health_routes",
            "backend.routes.download_routes",
            "backend.routes.market",
            "run_pipeline"
        )
        foreach ($mod in $modules) {
            $oldEap = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            $result = (& $Python -c "import sys; sys.path.insert(0, r'$Root'); import $mod; print('ok')" 2>&1 | Out-String)
            $exitCode = $LASTEXITCODE
            $ErrorActionPreference = $oldEap

            if ($exitCode -eq 0 -and ($result -match "ok")) {
                Write-Pass "import $mod"
            } else {
                Write-Fail "import $mod"
            }
        }
    }

    if ($Quick) {
        Write-Section "SUMMARY (Quick mode)"
        Write-Host "  Passed:  $Passed" -ForegroundColor Green
        Write-Host "  Failed:  $Failed" -ForegroundColor $(if ($Failed -gt 0) { 'Red' } else { 'Green' })
        exit $(if ($Failed -gt 0) { 1 } else { 0 })
    }

    Write-Section "4. START LOCAL SERVER"
    $port = 8099

    $existing = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if ($existing) {
        $existing | ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500
    }

    Write-Host "  Starting Flask on port $port..." -ForegroundColor Yellow
    $env:PYTHONPATH = $Root
    $env:PORT = "$port"

    $serverJob = Start-Job -ScriptBlock {
        param($py, $root, $localPort)
        $env:PYTHONPATH = $root
        $env:PORT = $localPort
        & $py -c "import sys, os; sys.path.insert(0, r'$root'); os.environ.setdefault('PORT', '$localPort'); from backend.server import app; app.run(host='127.0.0.1', port=int('$localPort'), debug=False, use_reloader=False)" 2>&1
    } -ArgumentList $Python, $Root, $port

    $ready = $false
    for ($i = 0; $i -lt 24; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2 -ErrorAction Stop
            if ($r.StatusCode -in @(200, 207)) {
                $ready = $true
                break
            }
        } catch {
        }
    }

    if (-not $ready) {
        $jobOut = Receive-Job $serverJob -ErrorAction SilentlyContinue
        Write-Fail "Server failed to start on port $port."
        Write-Host ($jobOut | Select-Object -Last 20 | Out-String)
        Stop-Job $serverJob -ErrorAction SilentlyContinue
        Remove-Job $serverJob -ErrorAction SilentlyContinue
        exit 1
    }
    Write-Pass "Server started on port $port"

    Write-Section "5. API ENDPOINT TESTS"
    Test-EndpointAny $port "/health" @(200, 207) "/health"
    Test-Endpoint $port "/api/stock/VCB" 200 "/api/stock/VCB"
    Test-Endpoint $port "/api/current-price/VCB" 200 "/api/current-price/VCB"
    Test-Endpoint $port "/api/tickers" 200 "/api/tickers"
    Test-Endpoint $port "/api/market/vci-indices" 200 "/api/market/vci-indices"
    Test-Endpoint $port "/api/market/news" 200 "/api/market/news"
    Test-Endpoint $port "/api/market/gold" 200 "/api/market/gold"
    Test-Endpoint $port "/api/market/top-movers" 200 "/api/market/top-movers"
    Test-Endpoint $port "/api/valuation/VCB" 200 "/api/valuation/VCB"
    Test-Endpoint $port "/api/stock/holders/VCB" 200 "/api/stock/holders/VCB"

    try {
        $downloadResp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/download/VCB" -TimeoutSec 8 -ErrorAction Stop
        if ($downloadResp.StatusCode -lt 500) {
            Write-Pass "$($downloadResp.StatusCode) /api/download/VCB"
        } else {
            Write-Fail "Server error $($downloadResp.StatusCode) - /api/download/VCB"
        }
    } catch {
        $dCode = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $dCode = [int]$_.Exception.Response.StatusCode
        }
        if ($dCode -gt 0 -and $dCode -lt 500) {
            Write-Pass "$dCode /api/download/VCB (non-5xx)"
        } else {
            Write-Fail "/api/download/VCB - $($_.Exception.Message)"
        }
    }

    Write-Section "6. RESPONSE VALIDATION"
    Test-JsonField $port "/health" "status" "/health"
    Test-JsonField $port "/api/stock/VCB" "symbol" "/api/stock/VCB"
    Test-JsonField $port "/api/valuation/VCB" "valuations" "/api/valuation/VCB"

    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job $serverJob -ErrorAction SilentlyContinue

    Write-Section "TEST SUMMARY"
    Write-Host "  Passed:  $Passed" -ForegroundColor Green
    Write-Host "  Failed:  $Failed" -ForegroundColor $(if ($Failed -gt 0) { 'Red' } else { 'Green' })
    Write-Host "  Skipped: $Skipped" -ForegroundColor Yellow

    if ($Failed -gt 0) {
        Write-Host "Tests failed. Do not deploy." -ForegroundColor Red
        exit 1
    }

    Write-Host "All tests passed. Safe to deploy." -ForegroundColor Green
    exit 0
}
finally {
    Pop-Location
}
