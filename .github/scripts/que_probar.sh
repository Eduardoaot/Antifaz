#!/usr/bin/env bash
# Decide qué pruebas corre la CI según lo que cambió. Escribe true/false en $GITHUB_OUTPUT.
#
# - Cambios solo en docs/, qa/ o archivos .md: no se prueba nada.
# - Push a una rama con PR abierto: no se prueba aquí; lo hace la corrida del PR.
# - Push a una rama sin PR: solo las revisiones rápidas. Las E2E (unos 20 min) corren en el PR.
# - PR, push a main, corrida semanal o manual: también las E2E, si cambió algo que las afecta.
#
# Siempre se compara contra la base de main, no contra el push anterior: así un push que solo
# toca docs no deja en verde una rama cuyo sidecar sigue roto.
set -euo pipefail

evento="${EVENTO:?falta EVENTO}"
rama="${RAMA:-}"
salida="${GITHUB_OUTPUT:-/dev/stdout}"
resumen="${GITHUB_STEP_SUMMARY:-/dev/stderr}"

escribir() {
  {
    echo "herramientas=$1"
    echo "sidecar=$2"
    echo "interfaz=$3"
    echo "e2e=$4"
  } >> "$salida"
  {
    echo "### Qué se prueba"
    echo ""
    echo "| Parte | ¿Corre? |"
    echo "|---|---|"
    echo "| Herramientas y catálogo | $1 |"
    echo "| Sidecar | $2 |"
    echo "| Interfaz | $3 |"
    echo "| E2E y accesibilidad | $4 |"
    echo ""
    echo "$5"
  } >> "$resumen"
}

case "$evento" in
  schedule | workflow_dispatch)
    escribir true true true true "Corrida completa ($evento)."
    exit 0
    ;;
  push | pull_request) ;;
  *)
    # Un evento nuevo que nadie previó: se prueba todo antes que dejar algo sin revisar.
    escribir true true true true "Evento no previsto ($evento): se prueba todo."
    exit 0
    ;;
esac

if [ "$evento" = "push" ] && [ "$rama" != "main" ] && [ -n "${GH_TOKEN:-}" ]; then
  abiertos="$(gh pr list --head "$rama" --state open --json number --jq 'length')"
  if [ "$abiertos" != "0" ]; then
    escribir false false false false "La rama \`$rama\` tiene un PR abierto: la corrida del PR hace las pruebas."
    exit 0
  fi
fi

if [ "$evento" = "push" ] && [ "$rama" = "main" ]; then
  base="${ANTES:-}"
  if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "${base}^{commit}" 2> /dev/null; then
    base="HEAD~1"
  fi
else
  destino="${BASE_PR:-main}"
  git fetch --no-tags --quiet origin "$destino"
  base="$(git merge-base "origin/$destino" HEAD)"
fi

cambios="$(git diff --name-only "$base" HEAD)"
hay() { printf '%s\n' "$cambios" | grep -qE "$1"; }
si() { if hay "$1"; then echo true; else echo false; fi; }

if hay '^\.github/'; then
  herramientas=true sidecar=true interfaz=true e2e=true
  motivo="Cambió la CI: se prueba todo."
else
  herramientas="$(si '^(tools/|rules/|brand/)')"
  sidecar="$(si '^(sidecar/|tools/descargar_modelos\.py$)')"
  interfaz="$(si '^(app/|tests-ui/|rules/|brand/|package(-lock)?\.json$|tsconfig\.json$|eslint\.config\.mjs$|vitest\.config\.ts$|electron\.vite\.config\.ts$)')"
  e2e="$(si '^(app/|tests-ui/e2e/|sidecar/revisor/|sidecar/pyproject\.toml$|sidecar/uv\.lock$|rules/|brand/|package(-lock)?\.json$|electron\.vite\.config\.ts$|playwright\.config\.ts$|tools/descargar_modelos\.py$)')"
  motivo="Según los archivos que cambiaron desde \`${base:0:7}\`."
fi

if [ "$evento" = "push" ] && [ "$rama" != "main" ] && [ "$e2e" = "true" ]; then
  e2e=false
  motivo="$motivo Las E2E correrán cuando abras el PR."
fi

escribir "$herramientas" "$sidecar" "$interfaz" "$e2e" "$motivo"
