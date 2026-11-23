#!/bin/zsh
set -euo pipefail
setopt NO_BG_NICE

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
LOCAL_URL="http://127.0.0.1:${PORT}/"

LAN_IP=""
for iface in en0 en1 en2 bridge0; do
  LAN_IP="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  if [[ -n "$LAN_IP" ]]; then
    break
  fi
done
LOCAL_HOST="$(scutil --get LocalHostName 2>/dev/null || true)"

print_urls() {
  echo "  Mac (locale):    ${LOCAL_URL}"
  if [[ -n "$LAN_IP" ]]; then
    echo "  iPad (Wi-Fi IP): http://${LAN_IP}:${PORT}/"
  else
    echo "  iPad (Wi-Fi IP): nessun indirizzo locale rilevato"
  fi
  if [[ -n "$LOCAL_HOST" ]]; then
    echo "  iPad (Bonjour):  http://${LOCAL_HOST}.local:${PORT}/"
  fi
  echo "--------------------------------------------------"
  echo "  Su iPad (stessa rete Wi-Fi del Mac):"
  echo "  1. Apri uno degli indirizzi iPad in Safari."
  echo "  2. Tocca Condividi -> «Aggiungi alla schermata Home» per schermo intero."
  echo "=================================================="
}

echo "=================================================="
echo "  Il tavolo del cartografo — Avvio Mac + Wi-Fi iPad"
echo "  Cartella: $PROJECT_DIR"

if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  Stato: server già attivo sulla porta ${PORT}"
  echo "--------------------------------------------------"
  print_urls
  open "$LOCAL_URL"
  exit 0
fi

if [[ ! -d "node_modules" ]]; then
  echo "Installazione delle dipendenze (prima esecuzione)..."
  npm install
fi

NEED_BUILD=0
if [[ ! -f "dist/index.html" ]]; then
  NEED_BUILD=1
elif [[ -n "$(find src public index.html package.json vite.config.ts -newer dist/index.html -print -quit 2>/dev/null)" ]]; then
  NEED_BUILD=1
fi

if [[ "$NEED_BUILD" -eq 1 ]]; then
  echo "Compilazione aggiornata dell'applicazione (dist/)..."
  npm run build
fi

echo "--------------------------------------------------"
print_urls
echo "  Lascia questa finestra aperta mentre usi l'editor (Ctrl+C per chiudere)."

(sleep 1 && open "$LOCAL_URL") >/dev/null 2>&1 &
npm run preview -- --host 0.0.0.0 --port "${PORT}" --strictPort
