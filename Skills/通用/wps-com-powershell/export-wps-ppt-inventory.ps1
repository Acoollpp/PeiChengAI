param(
  [Parameter(Mandatory=$true)]
  [string]$PptPath,

  [Parameter(Mandatory=$true)]
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

function OleToHex($ole) {
  if ($null -eq $ole -or $ole -eq '') { return '' }
  try { $v = [int64]$ole } catch { return '' }
  if ($v -lt 0) { return '' }
  $r = $v -band 255
  $g = ($v -shr 8) -band 255
  $b = ($v -shr 16) -band 255
  return ('#{0:X2}{1:X2}{2:X2}' -f $r, $g, $b)
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$pptFull = (Resolve-Path -LiteralPath $PptPath).Path
$shapeCsv = Join-Path $OutputDir 'wps_shape_inventory.csv'
$textCsv = Join-Path $OutputDir 'wps_text_inventory.csv'
$tableCsv = Join-Path $OutputDir 'wps_table_inventory.csv'
$summaryJson = Join-Path $OutputDir 'wps_deck_summary.json'

try {
  $app = [Runtime.InteropServices.Marshal]::GetActiveObject('KWPP.Application')
} catch {
  $app = New-Object -ComObject KWPP.Application
}

$p = $app.Presentations.Open($pptFull, $true, $false, $false)

$shapeRows = New-Object System.Collections.Generic.List[object]
$textRows = New-Object System.Collections.Generic.List[object]
$tableRows = New-Object System.Collections.Generic.List[object]
$slides = New-Object System.Collections.Generic.List[object]

for ($si = 1; $si -le $p.Slides.Count; $si++) {
  $slide = $p.Slides.Item($si)
  $slides.Add([pscustomobject]@{
    index = $si
    name = $slide.Name
    layout = $slide.Layout
    shapes = $slide.Shapes.Count
  }) | Out-Null

  for ($i = 1; $i -le $slide.Shapes.Count; $i++) {
    $shape = $slide.Shapes.Item($i)
    $fill = ''
    $line = ''
    $hasText = 0

    try { if ($shape.Fill.Visible) { $fill = OleToHex $shape.Fill.ForeColor.RGB } } catch {}
    try { if ($shape.Line.Visible) { $line = OleToHex $shape.Line.ForeColor.RGB } } catch {}
    try { $hasText = $shape.HasTextFrame } catch {}

    $shapeRows.Add([pscustomobject]@{
      slide = $si
      shape = $i
      name = $shape.Name
      type = $shape.Type
      left = [math]::Round($shape.Left, 2)
      top = [math]::Round($shape.Top, 2)
      width = [math]::Round($shape.Width, 2)
      height = [math]::Round($shape.Height, 2)
      fill = $fill
      line = $line
      hasText = $hasText
    }) | Out-Null

    try {
      if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
        $tr = $shape.TextFrame.TextRange
        $font = ''
        $size = ''
        $color = ''
        $bold = ''
        try { $font = $tr.Font.Name } catch {}
        try { $size = [math]::Round($tr.Font.Size, 1) } catch {}
        try { $color = OleToHex $tr.Font.Color.RGB } catch {}
        try { $bold = $tr.Font.Bold } catch {}
        $textRows.Add([pscustomobject]@{
          slide = $si
          shape = $i
          name = $shape.Name
          type = $shape.Type
          left = [math]::Round($shape.Left, 2)
          top = [math]::Round($shape.Top, 2)
          width = [math]::Round($shape.Width, 2)
          height = [math]::Round($shape.Height, 2)
          font = $font
          size = $size
          color = $color
          bold = $bold
          text = $tr.Text
        }) | Out-Null
      }
    } catch {}

    try {
      if ($shape.HasTable) {
        $tbl = $shape.Table
        for ($r = 1; $r -le $tbl.Rows.Count; $r++) {
          for ($c = 1; $c -le $tbl.Columns.Count; $c++) {
            $cellText = ''
            try { $cellText = $tbl.Cell($r, $c).Shape.TextFrame.TextRange.Text } catch {}
            $tableRows.Add([pscustomobject]@{
              slide = $si
              shape = $i
              row = $r
              col = $c
              text = $cellText
            }) | Out-Null
          }
        }
      }
    } catch {}
  }
}

$shapeRows | Export-Csv -LiteralPath $shapeCsv -NoTypeInformation -Encoding UTF8
$textRows | Export-Csv -LiteralPath $textCsv -NoTypeInformation -Encoding UTF8
$tableRows | Export-Csv -LiteralPath $tableCsv -NoTypeInformation -Encoding UTF8

[pscustomobject]@{
  source = $pptFull
  slide_count = $p.Slides.Count
  width_pt = [math]::Round($p.PageSetup.SlideWidth, 2)
  height_pt = [math]::Round($p.PageSetup.SlideHeight, 2)
  slides = $slides
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $summaryJson -Encoding UTF8

$p.Close()

Write-Output "Exported inventory to $OutputDir"
