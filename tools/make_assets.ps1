Add-Type -AssemblyName System.Drawing
$root = "C:\Users\mvalero\Desktop\Claude Work\northland-hydro\assets"
New-Item -ItemType Directory -Force $root | Out-Null

function Drop([System.Drawing.Graphics]$g, [float]$cx, [float]$cy, [float]$r, [System.Drawing.Brush]$b) {
  # raindrop: circle + triangle top
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($cx - $r, $cy - $r * 0.35, 2 * $r, 2 * $r, 20, 140)   # bottom arc (from right-lower to left-lower)... adjust by using full ellipse then triangle
  $p.CloseFigure()
  $g.FillEllipse($b, $cx - $r, $cy - $r * 0.35, 2 * $r, 2 * $r)
  $pts = @([System.Drawing.PointF]::new($cx, $cy - $r * 1.7), [System.Drawing.PointF]::new($cx - $r * 0.93, $cy + $r * 0.3), [System.Drawing.PointF]::new($cx + $r * 0.93, $cy + $r * 0.3))
  $g.FillPolygon($b, $pts)
}
function Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 22, 33, 58))
  $g.FillEllipse($bg, 0, 0, $size, $size)
  $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
  Drop $g ($size * 0.5) ($size * 0.5) ($size * 0.22) $blue
  # wave line
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 226, 237, 247)), ($size * 0.05)
  $pen.StartCap = "Round"; $pen.EndCap = "Round"
  $w = $size * 0.5; $x0 = $size * 0.25; $y = $size * 0.8
  $pts = @()
  for ($i = 0; $i -le 20; $i++) { $t = $i / 20.0; $pts += [System.Drawing.PointF]::new($x0 + $t * $w, $y + [Math]::Sin($t * 2 * [Math]::PI) * $size * 0.035) }
  $g.DrawCurve($pen, $pts)
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
Icon 180 "$root\icon-180.png"
Icon 192 "$root\icon-192.png"
Icon 512 "$root\icon-512.png"

# OG card 1200x630
$bmp = New-Object System.Drawing.Bitmap 1200, 630
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = "AntiAlias"; $g.TextRenderingHint = "AntiAliasGridFit"
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0, 0)), ([System.Drawing.Point]::new(1200, 630)), ([System.Drawing.Color]::FromArgb(255, 15, 23, 42)), ([System.Drawing.Color]::FromArgb(255, 30, 42, 72))
$g.FillRectangle($grad, 0, 0, 1200, 630)
# contour-like arcs
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 56, 189, 248)), 2
for ($i = 0; $i -lt 9; $i++) { $g.DrawEllipse($pen, 700 + $i * 28, 120 + $i * 40, 700 - $i * 40, 620 - $i * 60) }
$blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 56, 189, 248))
Drop $g 130 190 46 $blue
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 230, 237, 247))
$grey = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 169, 182, 207))
$fTitle = New-Object System.Drawing.Font "Segoe UI", 64, ([System.Drawing.FontStyle]::Bold)
$fSub = New-Object System.Drawing.Font "Segoe UI", 28
$fSmall = New-Object System.Drawing.Font "Segoe UI", 20
$g.DrawString("Northland Eco", $fTitle, $white, 210, 130)
$g.DrawString("Rain, rivers, watersheds, soils, wetlands,", $fSub, $grey, 216, 250)
$g.DrawString("flood zones, wells and lidar for NE Minnesota", $fSub, $grey, 216, 292)
$g.DrawString("One map for site investigation  |  MN SWCD Technical Service Area 3", $fSmall, $grey, 216, 400)
$g.DrawString("Free and open source", $fSmall, $blue, 216, 440)
$g.Dispose()
$bmp.Save("$root\og.png", [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
Get-ChildItem $root | Select-Object Name, Length
