#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh"
fi

SCRIPT_DIR="${0:A:h}"
DEFAULT_DIR="/Users/eneaminelli/Developer/Git/map-creator"

if [[ -f "$SCRIPT_DIR/package.json" ]]; then
  PROJECT_DIR="$SCRIPT_DIR"
elif [[ -f "$DEFAULT_DIR/package.json" ]]; then
  PROJECT_DIR="$DEFAULT_DIR"
else
  echo "Errore: cartella del progetto non trovata ($DEFAULT_DIR)."
  read -r "?Premi Invio per chiudere..."
  exit 1
fi

cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Errore: Node.js o npm non trovati nel PATH."
  read -r "?Premi Invio per chiudere..."
  exit 1
fi

PORT=5173
URL="http://127.0.0.1:${PORT}/"

echo "=================================================="
echo "  Il tavolo del cartografo — Avvio locale"
echo "  Cartella: $PROJECT_DIR"
echo "=================================================="

if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "L'applicazione è già in esecuzione su ${URL}."
  open "$URL"
  exit 0
fi

if [[ ! -d "node_modules" ]]; then
  echo "Installazione delle dipendenze (prima esecuzione)..."
  npm install
fi

if [[ ! -f "dist/index.html" ]]; then
  echo "Compilazione dell'applicazione..."
  npm run build
fi

echo ""
echo "Avvio su ${URL}"
echo "Per arrestare il server, premi Ctrl + C oppure chiudi questa finestra."
echo ""

npm run preview -- --host 127.0.0.1 --port "${PORT}" --strictPort --open
