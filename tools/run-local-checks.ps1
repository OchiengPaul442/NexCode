Write-Host "Running NEXCODE-KIBOKO local checks..."
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run test
exit $LASTEXITCODE
