#!/usr/bin/env bash
# Valide les Factur-X d'exemple avec Mustang (validateur de référence open source) :
# XSD Factur-X, schématron EN 16931 et conformité PDF/A-3b (veraPDF). Usage : npm run facturx:validate
set -euo pipefail

MUSTANG_VERSION="2.22.0"
MUSTANG_SHA256="ada3ac0d0d0eff4eb258eb206ce3a255ca8b81af78f06e225c1ef783ae58558d"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/atelier-mission"
JAR="$CACHE/Mustang-CLI-$MUSTANG_VERSION.jar"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"

command -v java >/dev/null || { echo "✘ Java est requis (Mustang est une application Java)"; exit 1; }
mkdir -p "$CACHE"
if [ ! -f "$JAR" ]; then
  echo "Téléchargement de Mustang $MUSTANG_VERSION…"
  curl -fsSL -o "$JAR.part" "https://github.com/ZUGFeRD/mustangproject/releases/download/core-$MUSTANG_VERSION/Mustang-CLI-$MUSTANG_VERSION.jar"
  echo "$MUSTANG_SHA256  $JAR.part" | sha256sum -c - >/dev/null
  mv "$JAR.part" "$JAR"
fi

(cd "$HERE" && npx tsx scripts/facturx-samples.ts "$OUT")

status=0
for pdf in "$OUT"/*.pdf; do
  report="${pdf%.pdf}.report.xml"
  java -Xmx1g -jar "$JAR" --action validate --source "$pdf" --no-notices >"$report" 2>/dev/null || true
  errors=$(grep -c '<error' "$report" || true)
  # Dernier <summary> = verdict global (PDF/A + XML).
  verdict=$(grep -o '<summary status="[a-z]*"' "$report" | tail -1 | sed 's/.*"\(.*\)"/\1/')
  if [ "$verdict" = "valid" ] && [ "$errors" = "0" ]; then
    echo "✔ $(basename "$pdf") : PDF/A-3b + EN 16931 valides"
  else
    echo "✘ $(basename "$pdf") : $verdict, $errors erreur(s)"
    grep -oE '\[[A-Z0-9-]+\][^<]{0,200}|isCompliant=[a-z]+[^<]{0,300}' "$report" | head -10
    status=1
  fi
done
rm -rf "$OUT"
exit $status
