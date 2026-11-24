import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EditorStore, useEditorStore } from '../state/editorStore';
import { PeerTransferManager } from '../transfer/peerTransfer';
import { extractPairingCodeFromQr, formatPairingCode, isValidPairingCode } from '../transfer/protocol';
import { buildPairingQrPayload, encodePairingQrMatrix } from '../transfer/qrCode';
import { ModalDialog } from './Dialogs';
import { DeviceLinkIcon, SendDeviceIcon } from './icons';

export interface DeviceTransferDialogProps {
  store: EditorStore;
  peerManager: PeerTransferManager;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRemainingTime(expiresAt: number | null, nowMs: number): string {
  if (!expiresAt) return '5:00';
  const remainingSec = Math.max(0, Math.ceil((expiresAt - nowMs) / 1000));
  const min = Math.floor(remainingSec / 60);
  const sec = remainingSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function DeviceTransferDialog({ store, peerManager }: DeviceTransferDialogProps) {
  const editorSnap = useEditorStore(store);
  const peerSnap = useSyncExternalStore(
    peerManager.subscribe,
    peerManager.getSnapshot,
    peerManager.getSnapshot
  );

  const nameInputId = useId();
  const codeInputId = useId();
  const signalInputId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafScanRef = useRef<number | null>(null);

  const [modeTab, setModeTab] = useState<'create' | 'join'>('create');
  const [nameDraft, setNameDraft] = useState(peerSnap.deviceName);
  const [codeDraft, setCodeDraft] = useState('');
  const [signalDraft, setSignalDraft] = useState(peerSnap.signalUrl);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setNameDraft(peerSnap.deviceName);
  }, [peerSnap.deviceName]);

  useEffect(() => {
    setSignalDraft(peerSnap.signalUrl);
  }, [peerSnap.signalUrl]);

  useEffect(() => {
    if (peerSnap.status !== 'waiting' || !peerSnap.roomExpiresAt) return;
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [peerSnap.status, peerSnap.roomExpiresAt]);

  const stopScanner = () => {
    if (rafScanRef.current !== null) {
      cancelAnimationFrame(rafScanRef.current);
      rafScanRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScannerActive(false);
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  useEffect(() => {
    if (peerSnap.status === 'connected' || peerSnap.status === 'connecting') {
      stopScanner();
    }
  }, [peerSnap.status]);

  const qrMatrix = useMemo(() => {
    if (!peerSnap.roomCode) return null;
    const origin =
      typeof window !== 'undefined' && window.location ? window.location.origin : undefined;
    const payload = buildPairingQrPayload(peerSnap.roomCode, origin);
    return encodePairingQrMatrix(payload);
  }, [peerSnap.roomCode]);

  const commitDeviceName = () => {
    peerManager.setDeviceName(nameDraft);
  };

  const handleCreateRoom = () => {
    stopScanner();
    peerManager.setDeviceName(nameDraft);
    peerManager.setSignalUrl(signalDraft);
    peerManager.createRoom(signalDraft);
  };

  const handleJoinRoom = () => {
    stopScanner();
    peerManager.setDeviceName(nameDraft);
    peerManager.setSignalUrl(signalDraft);
    peerManager.joinRoom(codeDraft, signalDraft);
  };

  const handleCopyCode = async () => {
    if (!peerSnap.roomCode) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(peerSnap.roomCode);
      }
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 1800);
    } catch {
      setCopiedNotice(false);
    }
  };

  const handleStartScanner = async () => {
    setScannerError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setScannerError('Fotocamera non disponibile in questo browser. Inserisci il codice a 6 caratteri.');
      return;
    }

    try {
      const [{ default: jsQR }, stream] = await Promise.all([
        import('jsqr'),
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        })
      ]);

      streamRef.current = stream;
      setScannerActive(true);

      await new Promise((r) => setTimeout(r, 30));
      const video = videoRef.current;
      if (!video) {
        stopScanner();
        return;
      }
      video.srcObject = stream;
      await video.play();

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        stopScanner();
        setScannerError('Impossibile inizializzare il lettore QR.');
        return;
      }

      const scanFrame = () => {
        if (!streamRef.current || !videoRef.current) return;
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(imageData.data, canvas.width, canvas.height, {
            inversionAttempts: 'dontInvert'
          });
          if (found?.data) {
            const parsed = extractPairingCodeFromQr(found.data);
            if (parsed) {
              setCodeDraft(parsed);
              stopScanner();
              peerManager.setDeviceName(nameDraft);
              peerManager.setSignalUrl(signalDraft);
              peerManager.joinRoom(parsed, signalDraft);
              return;
            }
          }
        }
        rafScanRef.current = requestAnimationFrame(scanFrame);
      };

      rafScanRef.current = requestAnimationFrame(scanFrame);
    } catch {
      stopScanner();
      setScannerError(
        'Permesso fotocamera negato o non disponibile. Puoi inserire manualmente il codice a 6 caratteri.'
      );
    }
  };

  const handleSendCurrentMap = () => {
    if (store.getStrokeSession().isActive()) {
      store.commitTerrainStroke();
    }
    void peerManager.sendMap(store.getDocument(), store.getExtraAssetBlobs());
  };

  const currentDocTitle = editorSnap.doc.manifest.title || 'Carta senza titolo';

  return (
    <ModalDialog
      title="Collega dispositivo (P2P Wi-Fi)"
      onClose={() => {
        stopScanner();
        store.closeDialog();
      }}
      initialFocusRef={closeBtnRef}
      footer={
        <button
          ref={closeBtnRef}
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            stopScanner();
            store.closeDialog();
          }}
        >
          Chiudi
        </button>
      }
    >
      <p className="panel-hint" style={{ margin: 0 }}>
        Abbina Mac e iPad con un codice breve o QR: solo l’abbinamento usa Cloudflare, poi le mappe
        viaggiano direttamente tra i due dispositivi in formato <code>.zip</code> cifrato.
      </p>

      <div className="form-field">
        <label className="field-label" htmlFor={nameInputId}>
          Nome di questo dispositivo
        </label>
        <div className="transfer-inline-row">
          <input
            id={nameInputId}
            type="text"
            className="text-input"
            maxLength={48}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitDeviceName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitDeviceName();
              }
            }}
          />
          <button type="button" className="btn btn-secondary" onClick={commitDeviceName}>
            Salva
          </button>
        </div>
      </div>

      {peerSnap.status === 'connected' ? (
        <div className="panel-group transfer-connected-card">
          <div className="slider-header">
            <span className="transfer-status-badge is-connected">
              <DeviceLinkIcon size={18} />
              <span>Collegato a {peerSnap.peerName}</span>
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => peerManager.disconnect()}
            >
              Scollega
            </button>
          </div>

          <p className="panel-hint" style={{ margin: 0 }}>
            Canale diretto P2P attivo. L’invio parte solo quando fai clic sul pulsante qui sotto.
          </p>

          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(peerSnap.transferProgress)}
            onClick={handleSendCurrentMap}
          >
            <SendDeviceIcon size={18} />
            <span>
              Invia «{currentDocTitle}» a {peerSnap.peerName}
            </span>
          </button>
        </div>
      ) : (
        <>
          <div className="segmented-group" role="tablist" aria-label="Modalità di abbinamento">
            <button
              type="button"
              role="tab"
              aria-selected={modeTab === 'create'}
              aria-pressed={modeTab === 'create'}
              className="segmented-btn"
              onClick={() => {
                stopScanner();
                setModeTab('create');
              }}
            >
              Mostra codice e QR
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modeTab === 'join'}
              aria-pressed={modeTab === 'join'}
              className="segmented-btn"
              onClick={() => setModeTab('join')}
            >
              Inserisci codice o scansiona
            </button>
          </div>

          {modeTab === 'create' ? (
            <div className="panel-group">
              {peerSnap.roomCode &&
              (peerSnap.status === 'waiting' || peerSnap.status === 'connecting') ? (
                <div className="transfer-code-panel">
                  <div className="slider-header">
                    <span className="field-label">Codice temporaneo ({formatRemainingTime(peerSnap.roomExpiresAt, nowMs)})</span>
                    <button type="button" className="btn btn-ghost" onClick={handleCopyCode}>
                      {copiedNotice ? 'Copiato!' : 'Copia codice'}
                    </button>
                  </div>

                  <div className="transfer-code-display tabular-nums" aria-live="polite">
                    {peerSnap.roomCode}
                  </div>

                  {qrMatrix ? (
                    <div className="transfer-qr-frame" aria-label={`Codice QR ${peerSnap.roomCode}`}>
                      <svg
                        viewBox={`0 0 ${qrMatrix.size} ${qrMatrix.size}`}
                        width="176"
                        height="176"
                        role="img"
                        aria-label={`QR abbinamento ${peerSnap.roomCode}`}
                        shapeRendering="crispEdges"
                      >
                        <rect width={qrMatrix.size} height={qrMatrix.size} fill="#F3EEDF" />
                        {qrMatrix.data.map((row, rIdx) =>
                          row.map((dark, cIdx) =>
                            dark ? (
                              <rect
                                key={`${rIdx}-${cIdx}`}
                                x={cIdx}
                                y={rIdx}
                                width={1}
                                height={1}
                                fill="#17232D"
                              />
                            ) : null
                          )
                        )}
                      </svg>
                    </div>
                  ) : null}

                  <p className="panel-hint" style={{ margin: 0, textAlign: 'center' }}>
                    {peerSnap.status === 'connecting'
                      ? `Apertura canale sicuro P2P con ${peerSnap.peerName ?? 'l’altro dispositivo'}…`
                      : 'Sull’iPad (o sull’altro dispositivo), apri «Collega dispositivo» e scansiona il QR o digita il codice.'}
                  </p>

                  <div className="transfer-inline-row" style={{ justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleCreateRoom}
                    >
                      Rigenera codice
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => peerManager.disconnect()}
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              ) : (
                <div className="transfer-code-panel">
                  <button type="button" className="btn btn-primary" onClick={handleCreateRoom}>
                    <DeviceLinkIcon size={18} />
                    <span>Genera codice e QR temporaneo</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="panel-group">
              <div className="form-field">
                <label className="field-label" htmlFor={codeInputId}>
                  Codice a 6 caratteri mostrato sull’altro dispositivo
                </label>
                <div className="transfer-inline-row">
                  <input
                    id={codeInputId}
                    type="text"
                    className="text-input tabular-nums"
                    placeholder="Es. K7M-9PX"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={8}
                    value={codeDraft}
                    onChange={(e) => setCodeDraft(formatPairingCode(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleJoinRoom();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!isValidPairingCode(codeDraft)}
                    onClick={handleJoinRoom}
                  >
                    Collega
                  </button>
                </div>
              </div>

              <div className="transfer-inline-row">
                {!scannerActive ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void handleStartScanner()}
                  >
                    Scansiona QR nell’app
                  </button>
                ) : (
                  <button type="button" className="btn btn-secondary" onClick={stopScanner}>
                    Ferma fotocamera
                  </button>
                )}
              </div>

              {scannerActive ? (
                <div className="transfer-scanner-wrap">
                  <video
                    ref={videoRef}
                    className="transfer-scanner-video"
                    playsInline
                    muted
                  />
                </div>
              ) : null}

              {scannerError ? (
                <p className="panel-hint" style={{ color: 'var(--ui-error)', margin: 0 }}>
                  {scannerError}
                </p>
              ) : null}
            </div>
          )}
        </>
      )}

      {peerSnap.transferProgress ? (
        <div className="panel-group" role="status" aria-live="polite">
          <div className="slider-header">
            <span className="field-label">
              {peerSnap.transferProgress.direction === 'send'
                ? `Invio «${peerSnap.transferProgress.title}»…`
                : `Ricezione «${peerSnap.transferProgress.title}»…`}
            </span>
            <span className="field-label tabular-nums">
              {Math.round(peerSnap.transferProgress.ratio * 100)}%
            </span>
          </div>
          <div className="transfer-progress-track">
            <div
              className="transfer-progress-fill"
              style={{ width: `${Math.round(peerSnap.transferProgress.ratio * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {peerSnap.errorMessage ? (
        <p className="panel-hint" role="alert" style={{ color: 'var(--ui-error)', margin: 0 }}>
          {peerSnap.errorMessage}
        </p>
      ) : null}

      {peerSnap.lastSentNotice ? (
        <p className="panel-hint" role="status" style={{ color: 'var(--ui-success)', margin: 0 }}>
          {peerSnap.lastSentNotice}
        </p>
      ) : null}

      <details className="transfer-advanced">
        <summary>Impostazioni server di handshake</summary>
        <div className="form-field" style={{ marginTop: '8px' }}>
          <label className="field-label" htmlFor={signalInputId}>
            Endpoint WebSocket di segnalazione
          </label>
          <input
            id={signalInputId}
            type="url"
            className="text-input"
            value={signalDraft}
            onChange={(e) => setSignalDraft(e.target.value)}
            onBlur={() => peerManager.setSignalUrl(signalDraft)}
          />
        </div>
      </details>
    </ModalDialog>
  );
}

export function IncomingTransferDialog({ store, peerManager }: DeviceTransferDialogProps) {
  const peerSnap = useSyncExternalStore(
    peerManager.subscribe,
    peerManager.getSnapshot,
    peerManager.getSnapshot
  );
  const openCopyBtnRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  const incoming = peerSnap.incomingMap;
  if (!incoming) return null;

  const handleOpenCopy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await store.importArchiveFile(incoming.bytes);
      peerManager.respondToIncoming(Boolean(res), res ? undefined : 'Archivio non valido.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveToLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const savedTitle = await store.saveIncomingArchiveToLibrary(incoming.bytes);
      peerManager.respondToIncoming(
        Boolean(savedTitle),
        savedTitle ? undefined : 'Errore nel salvataggio locale.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title="Carta ricevuta da altro dispositivo"
      onClose={() => peerManager.respondToIncoming(false, 'Trasferimento chiuso.')}
      initialFocusRef={openCopyBtnRef}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => peerManager.respondToIncoming(false, 'Trasferimento rifiutato.')}
          >
            Rifiuta
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void handleSaveToLibrary()}
          >
            Salva in archivio
          </button>
          <button
            ref={openCopyBtnRef}
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void handleOpenCopy()}
          >
            Apri nuova copia
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        <strong>{incoming.senderName}</strong> ti ha inviato la mappa{' '}
        <strong>«{incoming.title}»</strong> ({formatByteSize(incoming.byteLength)}).
      </p>
      <p className="panel-hint" style={{ margin: 0 }}>
        Integrità verificata via SHA-256. La mappa attualmente aperta non viene sovrascritta finché
        non scegli «Apri nuova copia».
      </p>
    </ModalDialog>
  );
}
