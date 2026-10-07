# Génère les icônes de l'extension : pwsh scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\src\icons'
New-Item -ItemType Directory -Force $out | Out-Null

foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 128.0

  # Fond : carré arrondi bleu
  $r = 28 * $s; $w = $size - 1
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, 2*$r, 2*$r, 180, 90)
  $path.AddArc($w - 2*$r, 0, 2*$r, 2*$r, 270, 90)
  $path.AddArc($w - 2*$r, $w - 2*$r, 2*$r, 2*$r, 0, 90)
  $path.AddArc(0, $w - 2*$r, 2*$r, 2*$r, 90, 90)
  $path.CloseFigure()
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 37, 99, 235))
  $g.FillPath($bg, $path)

  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  # Flèche vers le bas
  $g.FillRectangle($white, [float](54*$s), [float](24*$s), [float](20*$s), [float](42*$s))
  $pts = @(
    (New-Object System.Drawing.PointF ([float](34*$s)), ([float](60*$s))),
    (New-Object System.Drawing.PointF ([float](94*$s)), ([float](60*$s))),
    (New-Object System.Drawing.PointF ([float](64*$s)), ([float](92*$s)))
  )
  $g.FillPolygon($white, $pts)
  # Barre du bas
  $g.FillRectangle($white, [float](30*$s), [float](98*$s), [float](68*$s), [float](12*$s))

  $bmp.Save("$out\icon$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Get-ChildItem $out
