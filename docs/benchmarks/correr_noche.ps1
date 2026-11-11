# Benchmark nocturno: varios bloques, un JSON por bloque.
# Uso: dejar corriendo con la app cerrada. Cursor puede quedarse abierto.
$ErrorActionPreference = "Stop"
$raiz = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $raiz
# uv run usa las deps del script (incl. opencv-contrib para CSRT).
$uv = (Get-Command uv -ErrorAction SilentlyContinue)?.Source
if (-not $uv) {
  $uv = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uv.exe"
}
$log = Join-Path $raiz "docs\benchmarks\noche.log"
$hilos = 10

function Correr([string]$titulo, [string[]]$argsBench) {
  $linea = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') INICIO $titulo"
  Add-Content -Path $log -Value $linea
  Write-Host $linea
  & $uv run --python 3.12 tools\benchmark_video.py @argsBench
  $codigo = $LASTEXITCODE
  $fin = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') FIN $titulo exit=$codigo"
  Add-Content -Path $log -Value $fin
  Write-Host $fin
  if ($codigo -ne 0) {
    Add-Content -Path $log -Value "ABORTADO tras fallo en $titulo"
    exit $codigo
  }
}

"==== sesión $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====" | Set-Content -Path $log

# 1) Rejilla EdgeTAM 3 s (la que faltaba completar).
Correr "edgetam 3s rejilla" @(
  "--metodos", "edgetam",
  "--fps", "4", "8", "12", "24",
  "--proxy", "240", "360", "480",
  "--segundos", "3",
  "--fps-video", "24",
  "--hilos", "$hilos",
  "--salida", "docs\benchmarks\edgetam_3s.json"
)

# 2) CSRT en la misma rejilla: baseline barato para el híbrido.
Correr "csrt 3s rejilla" @(
  "--metodos", "csrt",
  "--fps", "4", "8", "12", "24",
  "--proxy", "240", "360", "480",
  "--segundos", "3",
  "--fps-video", "24",
  "--hilos", "$hilos",
  "--salida", "docs\benchmarks\csrt_3s.json"
)

# 3) Escalado de duración solo a 24 fps (único que no filtró en la corrida parcial).
foreach ($proxy in 240, 360, 480) {
  foreach ($seg in 10, 15) {
    Correr "edgetam ${seg}s proxy $proxy @24fps" @(
      "--metodos", "edgetam",
      "--fps", "24",
      "--proxy", "$proxy",
      "--segundos", "$seg",
      "--fps-video", "24",
      "--hilos", "$hilos",
      "--salida", "docs\benchmarks\edgetam_${seg}s_proxy${proxy}_24fps.json"
    )
  }
}

# 4) CSRT en 15 s a 24 fps: cuánto costaría el brazo barato del híbrido.
Correr "csrt 15s @24fps" @(
  "--metodos", "csrt",
  "--fps", "24",
  "--proxy", "240", "360", "480",
  "--segundos", "15",
  "--fps-video", "24",
  "--hilos", "$hilos",
  "--salida", "docs\benchmarks\csrt_15s_24fps.json"
)

Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') LISTO"
Write-Host "LISTO"
