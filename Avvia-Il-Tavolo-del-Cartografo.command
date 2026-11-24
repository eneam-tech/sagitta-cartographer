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
  echo "  Su iPad (stessa rete Wi-Fi del Mac, no rete Ospiti):"
  echo "  1. Lascia aperta questa finestra del Terminale sul Mac."
  echo "  2. In Safari su iPad scrivi l'indirizzo completo con http:// iniziale."
  echo "  3. Se richiesto o bloccato: abilita «Rete locale» per Safari (iPad)"
  echo "     e per Terminale (Mac -> Impostazioni -> Privacy e sicurezza -> Rete locale)."
  echo "  4. Opzionale: Condividi -> «Aggiungi alla schermata Home» per schermo intero."
  echo "=================================================="
}

echo "=================================================="
echo "  Sagitta - Cartografo — Avvio Mac + Wi-Fi iPad"
echo "  Cartella: $PROJECT_DIR"

LISTENING_LINES="$(lsof -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$LISTENING_LINES" ]]; then
  if [[ "$LISTENING_LINES" == *"*:${PORT}"* ]]; then
    echo "  Stato: server già attivo sulla rete Wi-Fi (porta ${PORT})"
    echo "--------------------------------------------------"
    print_urls
    open "$LOCAL_URL"
    exit 0
  else
    echo "  Trovato un vecchio server solo locale su 127.0.0.1:${PORT} — riavvio sulla rete Wi-Fi..."
    OLD_PIDS=(${(f)"$(lsof -t -nP -iTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"})
    if (( ${#OLD_PIDS[@]} > 0 )); then
      kill "${OLD_PIDS[@]}" 2>/dev/null || true
      for _ in {1..20}; do
        if ! lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
          break
        fi
        sleep 0.1
      done
      if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
        kill -9 "${OLD_PIDS[@]}" 2>/dev/null || true
        sleep 0.2
      fi
    fi
  fi
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
npm run preview -- --host --port "${PORT}" --strictPort
