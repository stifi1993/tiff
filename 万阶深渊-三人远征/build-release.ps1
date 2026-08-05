$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot
$repoRoot = (git -C $projectDir rev-parse --show-toplevel).Trim()
$releaseDir = Join-Path $projectDir "release"
$outputFile = Join-Path $releaseDir "abyss-expedition-v3-web.zip"

if (-not (Test-Path -LiteralPath $releaseDir)) {
  New-Item -ItemType Directory -Path $releaseDir | Out-Null
}

git -C $repoRoot archive --format=zip --output=$outputFile HEAD -- "万阶深渊-三人远征"
if ($LASTEXITCODE -ne 0) { throw "发行包生成失败" }

$sizeMb = [Math]::Round((Get-Item -LiteralPath $outputFile).Length / 1MB, 1)
Write-Host "发行包已生成：$outputFile（$sizeMb MB）"
