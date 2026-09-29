Add-Type -AssemblyName System.Drawing
$root   = 'F:\everyAI\all\model-router-galgame'
$rawDir = Join-Path $root 'output\spring\raw'
$porDir = Join-Path $root '.dsh-plugin\client\spring-portraits'
$bgDir  = Join-Path $root '.dsh-plugin\client\spring-backgrounds'
New-Item -ItemType Directory -Force -Path $porDir, $bgDir | Out-Null

# 3x2 sheet -> neutral, happy, sad / determined, surprised, shy
$moods = @('neutral','happy','sad','determined','surprised','shy')

function Trim-Alpha([System.Drawing.Bitmap]$bmp) {
  $minX = $bmp.Width; $minY = $bmp.Height; $maxX = 0; $maxY = 0
  for ($y = 0; $y -lt $bmp.Height; $y += 2) {
    for ($x = 0; $x -lt $bmp.Width; $x += 2) {
      if ($bmp.GetPixel($x, $y).A -gt 8) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($maxX -le $minX -or $maxY -le $minY) { return $bmp }
  $pad = 6
  $minX = [Math]::Max(0, $minX - $pad); $minY = [Math]::Max(0, $minY - $pad)
  $w = [Math]::Min($bmp.Width - $minX, $maxX - $minX + $pad * 2)
  $h = [Math]::Min($bmp.Height - $minY, $maxY - $minY + $pad * 2)
  $out = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), (New-Object System.Drawing.Rectangle($minX, $minY, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $bmp.Dispose()
  return $out
}

$total = 0
$manifest = @()
foreach ($file in (Get-ChildItem "$rawDir\*.png")) {
  $name = $file.BaseName
  if ($name -match '背景|background|Production_anime|Visual_novel') { continue }
  $char = ($name -split '_')[0].ToLower()
  if (-not $char) { continue }
  $img = [System.Drawing.Image]::FromFile($file.FullName)
  $cellW = [int]([Math]::Floor($img.Width / 3))
  $cellH = [int]([Math]::Floor($img.Height / 2))
  for ($index = 0; $index -lt 6; $index += 1) {
    $col = $index % 3
    $row = [Math]::Floor($index / 3)
    $cell = New-Object System.Drawing.Bitmap($cellW, $cellH)
    $g = [System.Drawing.Graphics]::FromImage($cell)
    $srcRect = New-Object System.Drawing.Rectangle(($col * $cellW), ($row * $cellH), $cellW, $cellH)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $cellW, $cellH)), $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $cell = Trim-Alpha $cell
    # Cap portrait height at 480px to keep the bundle small.
    if ($cell.Height -gt 480) {
      $nw = [int]($cell.Width * 480 / $cell.Height)
      $resized = New-Object System.Drawing.Bitmap($nw, 480)
      $rg = [System.Drawing.Graphics]::FromImage($resized)
      $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $rg.DrawImage($cell, 0, 0, $nw, 480)
      $rg.Dispose()
      $cell.Dispose()
      $cell = $resized
    }
    $dst = Join-Path $porDir ("$char-$($moods[$index]).png")
    $cell.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
    $kb = [int](([System.IO.FileInfo]::new($dst)).Length / 1KB)
    $total += $kb
    $manifest += "$char-$($moods[$index]) $kb KB"
    $cell.Dispose()
  }
  $img.Dispose()
}
$manifest | ForEach-Object { Write-Host $_ }
Write-Host "PORTRAITS TOTAL $([Math]::Round($total/1024,1)) MB"
