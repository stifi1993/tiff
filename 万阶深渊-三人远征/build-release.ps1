$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot
$repoRoot = (git -C $projectDir rev-parse --show-toplevel).Trim()
$projectName = Split-Path -Leaf $projectDir
$releaseDir = Join-Path $projectDir "release"
$outputFile = Join-Path $releaseDir "abyss-expedition-v3-web.zip"

if (-not (Test-Path -LiteralPath $releaseDir)) {
  New-Item -ItemType Directory -Path $releaseDir | Out-Null
}

git -C $repoRoot archive --format=zip --output=$outputFile HEAD -- $projectName
if ($LASTEXITCODE -ne 0) { throw "Release archive failed" }

$sizeMb = [Math]::Round((Get-Item -LiteralPath $outputFile).Length / 1MB, 1)
Write-Host "Release archive created: $outputFile ($sizeMb MB)"
