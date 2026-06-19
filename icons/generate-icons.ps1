# Generates icon16/48/128.png — a red "ban" mark (filled circle + ring + diagonal slash).
# Run from anywhere: powershell -ExecutionPolicy Bypass -File generate-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$red   = [System.Drawing.Color]::FromArgb(255, 204, 0, 0)
$white = [System.Drawing.Color]::White

foreach ($size in 16, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [double]$size * 0.06
    $d = [double]$size - 2 * $pad

    # Filled red disc
    $brush = New-Object System.Drawing.SolidBrush $red
    $g.FillEllipse($brush, $pad, $pad, $d, $d)

    # White ring + diagonal slash forming the "no" symbol
    $penW = [Math]::Max(1.5, $size * 0.10)
    $pen = New-Object System.Drawing.Pen $white, $penW
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $ringPad = $pad + $size * 0.20
    $ringD = [double]$size - 2 * $ringPad
    $g.DrawEllipse($pen, $ringPad, $ringPad, $ringD, $ringD)

    # 45-degree slash across the ring
    $a = $ringPad + $ringD * 0.15
    $b = $ringPad + $ringD * 0.85
    $g.DrawLine($pen, $a, $a, $b, $b)

    $g.Dispose()
    $path = Join-Path $outDir "icon$size.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "wrote $path"
}
