$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$rawDir = Join-Path $projectRoot 'output\echo-city-art\raw'
$portraitDir = Join-Path $projectRoot '.dsh-plugin\client\echo-portraits'
$backgroundDir = Join-Path $projectRoot '.dsh-plugin\client\echo-backgrounds'
New-Item -ItemType Directory -Force -Path $portraitDir, $backgroundDir | Out-Null

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  throw 'ffmpeg is required to build the Echo City visual assets.'
}

$backgrounds = @('gate-snow', 'petition-wall', 'old-tower-snow', 'flame-platform', 'seal-chamber', 'two-lamps')
foreach ($name in $backgrounds) {
  $inputPath = Join-Path $rawDir "$name.png"
  $outputPath = Join-Path $backgroundDir "$name.webp"
  if (-not (Test-Path -LiteralPath $inputPath)) { throw "Missing background source: $inputPath" }
  & ffmpeg -hide_banner -loglevel error -y -i $inputPath -vf 'crop=1536:864:0:80,scale=1280:720:flags=lanczos' -c:v libwebp -q:v 82 -compression_level 6 $outputPath
  if ($LASTEXITCODE -ne 0) { throw "Failed to convert background: $name" }
}

$moods = @('neutral', 'happy', 'sad', 'determined', 'surprised', 'shy')
$characters = @('chatgpt', 'claude', 'harness', 'ernie', 'minimax', 'huggingface', 'github', 'gitlab', 'gitee', 'cloudflare', 'comfyui', 'gptimage')
foreach ($character in $characters) {
  $inputPath = Join-Path $rawDir "portrait-$character.png"
  if (-not (Test-Path -LiteralPath $inputPath)) { throw "Missing portrait sheet: $inputPath" }
  for ($index = 0; $index -lt $moods.Count; $index++) {
    $x = ($index % 3) * 512
    $y = [int]([Math]::Floor($index / 3)) * 512
    $outputPath = Join-Path $portraitDir "$character-$($moods[$index]).webp"
    $filter = "crop=512:512:$($x):$($y),scale=480:480:flags=lanczos,format=yuva420p"
    & ffmpeg -hide_banner -loglevel error -y -i $inputPath -vf $filter -c:v libwebp -q:v 82 -compression_level 6 $outputPath
    if ($LASTEXITCODE -ne 0) { throw "Failed to convert portrait: $character/$($moods[$index])" }
  }
}

$sourceDir = Join-Path $projectRoot 'aipicture\echo-originals'
$sourceOutputDir = Join-Path $projectRoot '.dsh-plugin\client\source-portraits'
New-Item -ItemType Directory -Force -Path $sourceOutputDir | Out-Null
$originals = @('hy', 'novelai', 'comfyui', 'gptimage', 'jev')
foreach ($character in $originals) {
  $inputPath = Join-Path $sourceDir "$character.png"
  $outputPath = Join-Path $sourceOutputDir "$character.webp"
  if (-not (Test-Path -LiteralPath $inputPath)) { throw "Missing original portrait: $inputPath" }
  & ffmpeg -hide_banner -loglevel error -y -i $inputPath -vf 'scale=-2:1024:flags=lanczos,format=yuva420p' -c:v libwebp -q:v 86 -compression_level 6 $outputPath
  if ($LASTEXITCODE -ne 0) { throw "Failed to convert original portrait: $character" }
}

$indexLines = [System.Collections.Generic.List[string]]::new()
foreach ($name in $backgrounds) {
  $identifier = $name.Replace('-', '_')
  $indexLines.Add("import $identifier from './echo-backgrounds/$name.webp'")
}
$indexLines.Add('')
foreach ($character in $characters) {
  foreach ($mood in $moods) {
    $indexLines.Add("import $($character)_$mood from './echo-portraits/$character-$mood.webp'")
  }
  $indexLines.Add('')
}
$indexLines.Add('export const ECHO_SCENE_ART = Object.freeze({')
foreach ($name in $backgrounds) {
  $indexLines.Add("  'echo-$name': $($name.Replace('-', '_')),")
}
$indexLines.Add('})')
$indexLines.Add('')
$indexLines.Add('export const ECHO_PORTRAITS = Object.freeze({')
foreach ($character in $characters) {
  $fields = ($moods | ForEach-Object { "$($_): $($character)_$_" }) -join ', '
  $indexLines.Add("  $($character): Object.freeze({ $fields }),")
}
$indexLines.Add('})')
$indexLines.Add('')
$indexPath = Join-Path $projectRoot '.dsh-plugin\client\gal-echo-art.mjs'
[System.IO.File]::WriteAllText($indexPath, ($indexLines -join "`n"), [System.Text.UTF8Encoding]::new($false))

Write-Output "Built $($backgrounds.Count) backgrounds, $($characters.Count * $moods.Count) expression portraits and $($originals.Count) original portraits."
