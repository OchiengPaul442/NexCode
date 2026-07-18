#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Runs all E2E tests in agent-core/tests/e2e/
.DESCRIPTION
    Executes each .test.mjs file sequentially and reports results.
#>

$ErrorActionPreference = "Continue"
$testDir = $PSScriptRoot
$tests = Get-ChildItem -Path $testDir -Filter "*.test.mjs" | Sort-Object Name

if ($tests.Count -eq 0) {
    Write-Host "No .test.mjs files found in $testDir" -ForegroundColor Yellow
    exit 1
}

Write-Host "=== NexCode E2E Test Runner ===" -ForegroundColor Cyan
Write-Host "Found $($tests.Count) test file(s)`n"

$passed = 0
$failed = 0
$skipped = 0

foreach ($test in $tests) {
    Write-Host "--- $($test.BaseName) ---" -ForegroundColor White
    try {
        node $test.FullName
        if ($LASTEXITCODE -eq 0) {
            $passed++
            Write-Host "  Result: PASS`n" -ForegroundColor Green
        } else {
            $failed++
            Write-Host "  Result: FAIL (exit code $LASTEXITCODE)`n" -ForegroundColor Red
        }
    } catch {
        $failed++
        Write-Host "  Result: ERROR - $($_.Exception.Message)`n" -ForegroundColor Red
    }
}

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "  Passed:  $passed" -ForegroundColor Green
Write-Host "  Failed:  $failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })
Write-Host "  Total:   $($passed + $failed)"

if ($failed -gt 0) { exit 1 }
