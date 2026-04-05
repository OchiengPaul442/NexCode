param(
    [string[]]$Models = @("qwen2.5-coder:7b", "deepseek-coder", "gpt-oss:120b-cloud")
)

Write-Host "Checking Ollama..."
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) {
    Write-Error "Ollama is not installed or not on PATH. Install from https://ollama.com"
    exit 1
}

foreach ($model in $Models) {
    Write-Host "Pulling model: $model"
    ollama pull $model
}

Write-Host "Ollama setup complete."
