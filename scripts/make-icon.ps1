param(
  [Parameter(Mandatory = $true)][string]$PngPath,
  [Parameter(Mandatory = $true)][string]$IcoPath
)

Add-Type -AssemblyName System.Drawing

function Get-IconImageBytes {
  param([System.Drawing.Bitmap]$Bitmap)

  $w = $Bitmap.Width
  $h = $Bitmap.Height
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $lock = $Bitmap.LockBits(
    $rect,
    [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  try {
    $stride = $lock.Stride
    $raw = New-Object byte[] ($stride * $h)
    [Runtime.InteropServices.Marshal]::Copy($lock.Scan0, $raw, 0, $raw.Length)
  } finally {
    $Bitmap.UnlockBits($lock)
  }

  $xorSize = $w * $h * 4
  $andRow = [int][Math]::Ceiling($w / 32.0) * 4
  $andSize = $andRow * $h
  $bytes = New-Object byte[] (40 + $xorSize + $andSize)

  [BitConverter]::GetBytes([int32]40).CopyTo($bytes, 0)
  [BitConverter]::GetBytes([int32]$w).CopyTo($bytes, 4)
  [BitConverter]::GetBytes([int32]($h * 2)).CopyTo($bytes, 8)
  [BitConverter]::GetBytes([int16]1).CopyTo($bytes, 12)
  [BitConverter]::GetBytes([int16]32).CopyTo($bytes, 14)
  [BitConverter]::GetBytes([int32]($xorSize + $andSize)).CopyTo($bytes, 20)

  $dst = 40
  for ($y = $h - 1; $y -ge 0; $y--) {
    [Array]::Copy($raw, $y * $stride, $bytes, $dst, $w * 4)
    $dst += $w * 4
  }

  return $bytes
}

$resolvedPng = (Resolve-Path -LiteralPath $PngPath).Path
$src = [System.Drawing.Bitmap]::FromFile($resolvedPng)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = New-Object System.Collections.Generic.List[byte[]]

try {
  foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    $g.DrawImage($src, 0, 0, $size, $size)
    $g.Dispose()
    $images.Add((Get-IconImageBytes $bmp))
    $bmp.Dispose()
  }
} finally {
  $src.Dispose()
}

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$images.Count)

$offset = 6 + (16 * $images.Count)
for ($i = 0; $i -lt $images.Count; $i++) {
  $size = $sizes[$i]
  $dim = if ($size -ge 256) { [byte]0 } else { [byte]$size }
  $bw.Write($dim)
  $bw.Write($dim)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$images[$i].Length)
  $bw.Write([uint32]$offset)
  $offset += $images[$i].Length
}
foreach ($img in $images) {
  $bw.Write($img)
}
$bw.Flush()
[System.IO.File]::WriteAllBytes($IcoPath, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()
Write-Host "wrote $IcoPath ($($sizes -join ', ') px)"
