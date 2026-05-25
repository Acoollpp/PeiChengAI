param(
  [Parameter(Mandatory=$true)]
  [string]$PptPath,

  [Parameter(Mandatory=$true)]
  [string]$OutputDir,

  [int]$Width = 1600,

  [int]$Height = 900
)

$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$pptFull = (Resolve-Path -LiteralPath $PptPath).Path

try {
  $app = [Runtime.InteropServices.Marshal]::GetActiveObject('KWPP.Application')
} catch {
  $app = New-Object -ComObject KWPP.Application
}

$p = $app.Presentations.Open($pptFull, $true, $false, $false)
$count = $p.Slides.Count
$p.Export($OutputDir, 'PNG', $Width, $Height)
$p.Close()

Write-Output "Exported $count slide previews to $OutputDir"
