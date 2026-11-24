import { MapDocument, safeRandomUUID } from '../model/document';
import { exportProjectArchive } from '../persistence/archive';
import {
  detectDeviceKind,
  normalizeSignalWebSocketUrl,
  readStoredDeviceName,
  resolveDefaultSignalUrl,
  writeStoredDeviceName,
  writeStoredSignalUrl
} from './deviceIdentity';
import {
  DataMapOfferMessage,
  DeviceKindHint,
  MAX_ARCHIVE_BYTES,
  PAIRING_ROOM_TTL_MS,
  TRANSFER_CHUNK_BYTES,
  computeSha256Hex,
  formatPairingCode,
  generatePairingCode,
  isValidPairingCode,
  parseDataTransferControlMessage,
  parseSignalMessage
} from './protocol';

export type PeerConnectionStatus =
  | 'disconnected'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'error';

export interface TransferProgressState {
  direction: 'send' | 'receive';
  title: string;
  bytesDone: number;
  bytesTotal: number;
  ratio: number;
}

export interface IncomingMapTransfer {
  transferId: string;
  title: string;
  fileName: string;
  senderName: string;
  byteLength: number;
  bytes: Uint8Array;
}

export interface PeerTransferSnapshot {
  status: PeerConnectionStatus;
  deviceName: string;
  deviceKind: DeviceKindHint;
  signalUrl: string;
  roomCode: string | null;
  roomExpiresAt: number | null;
  peerName: string | null;
  peerKind: DeviceKindHint | null;
  errorMessage: string | null;
  transferProgress: TransferProgressState | null;
  incomingMap: IncomingMapTransfer | null;
  lastSentNotice: string | null;
}

interface PendingReceiveState {
  offer: DataMapOfferMessage;
  chunks: Uint8Array[];
  receivedBytes: number;
}

function buildSafeArchiveFileName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${slug || 'carta'}.zip`;
}

export class PeerTransferManager {
  private readonly listeners = new Set<() => void>();
  private snapshot: PeerTransferSnapshot;

  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  private receivingState: PendingReceiveState | null = null;
  private pendingAckWaiter: {
    transferId: string;
    resolve: (msg: { accepted: boolean; reason?: string }) => void;
    reject: (err: Error) => void;
  } | null = null;
  private sendingBusy = false;
  private disposed = false;

  constructor() {
    const kind = detectDeviceKind();
    this.snapshot = {
      status: 'disconnected',
      deviceName: readStoredDeviceName(),
      deviceKind: kind,
      signalUrl: resolveDefaultSignalUrl(),
      roomCode: null,
      roomExpiresAt: null,
      peerName: null,
      peerKind: null,
      errorMessage: null,
      transferProgress: null,
      incomingMap: null,
      lastSentNotice: null
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PeerTransferSnapshot => {
    return this.snapshot;
  };

  private updateSnapshot(patch: Partial<PeerTransferSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }

  setDeviceName(name: string): void {
    const saved = writeStoredDeviceName(name);
    if (saved === this.snapshot.deviceName) return;
    this.updateSnapshot({ deviceName: saved });
  }

  setSignalUrl(rawUrl: string): void {
    const savedRaw = writeStoredSignalUrl(rawUrl);
    const resolved = savedRaw ? normalizeSignalWebSocketUrl(savedRaw) : resolveDefaultSignalUrl();
    if (resolved === this.snapshot.signalUrl) return;
    this.updateSnapshot({ signalUrl: resolved });
  }

  clearNotices(): void {
    if (!this.snapshot.errorMessage && !this.snapshot.lastSentNotice) return;
    this.updateSnapshot({ errorMessage: null, lastSentNotice: null });
  }

  createRoom(customSignalUrl?: string): string {
    const code = generatePairingCode();
    this.connectToRoom(code, customSignalUrl);
    return code;
  }

  joinRoom(rawCode: string, customSignalUrl?: string): boolean {
    if (!isValidPairingCode(rawCode)) {
      this.updateSnapshot({
        status: 'error',
        errorMessage: 'Codice non valido: inserisci i 6 caratteri mostrati sull’altro dispositivo.'
      });
      return false;
    }
    this.connectToRoom(formatPairingCode(rawCode), customSignalUrl);
    return true;
  }

  disconnect(): void {
    this.teardownConnections();
    this.updateSnapshot({
      status: 'disconnected',
      roomCode: null,
      roomExpiresAt: null,
      peerName: null,
      peerKind: null,
      errorMessage: null,
      transferProgress: null
    });
  }

  private connectToRoom(code: string, customSignalUrl?: string): void {
    if (this.disposed) return;

    if (typeof WebSocket === 'undefined' || typeof RTCPeerConnection === 'undefined') {
      this.updateSnapshot({
        status: 'error',
        errorMessage: 'Questo browser non supporta WebRTC per il trasferimento diretto.'
      });
      return;
    }

    this.teardownConnections();

    const wsBase = customSignalUrl
      ? normalizeSignalWebSocketUrl(customSignalUrl)
      : this.snapshot.signalUrl;
    let targetWsUrl: URL;
    try {
      targetWsUrl = new URL(wsBase);
      if (targetWsUrl.protocol !== 'ws:' && targetWsUrl.protocol !== 'wss:') {
        throw new Error('Protocollo non valido');
      }
      targetWsUrl.searchParams.set('room', code);
    } catch {
      this.updateSnapshot({
        status: 'error',
        errorMessage: 'Indirizzo del server di handshake non valido.'
      });
      return;
    }

    this.updateSnapshot({
      status: 'waiting',
      signalUrl: wsBase,
      roomCode: code,
      roomExpiresAt: Date.now() + PAIRING_ROOM_TTL_MS,
      peerName: null,
      peerKind: null,
      errorMessage: null,
      lastSentNotice: null
    });

    let ws: WebSocket;
    try {
      ws = new WebSocket(targetWsUrl.toString());
    } catch {
      this.updateSnapshot({
        status: 'error',
        errorMessage: 'Impossibile contattare il server di handshake WebRTC.'
      });
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.ws !== ws || this.disposed) return;
      this.sendSignal({
        type: 'hello',
        deviceName: this.snapshot.deviceName,
        deviceKind: this.snapshot.deviceKind,
        protocolVersion: 1
      });
      this.pingTimer = setInterval(() => {
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
          this.sendSignal({ type: 'ping' });
        }
      }, 25_000);
    });

    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws || this.disposed || typeof ev.data !== 'string') return;
      const msg = parseSignalMessage(ev.data);
      if (!msg) return;
      void this.handleSignalMessage(msg);
    });

    ws.addEventListener('error', () => {
      if (this.ws !== ws || this.disposed) return;
      if (this.dc?.readyState === 'open') return;
      this.updateSnapshot({
        status: 'error',
        errorMessage:
          'Connessione al server di handshake non riuscita. Verifica Internet o la configurazione Cloudflare.'
      });
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.clearPingTimer();
      this.ws = null;
      // Se WebRTC P2P è già aperto, mantiene attiva la sessione locale senza dipendere dal WebSocket
      if (this.dc?.readyState === 'open' || this.disposed) return;
      if (this.snapshot.status === 'waiting' || this.snapshot.status === 'connecting') {
        this.updateSnapshot({
          status: 'disconnected',
          roomCode: null,
          roomExpiresAt: null,
          peerName: null,
          peerKind: null
        });
      }
    });
  }

  private async handleSignalMessage(
    msg: NonNullable<ReturnType<typeof parseSignalMessage>>
  ): Promise<void> {
    switch (msg.type) {
      case 'peer-joined': {
        this.updateSnapshot({
          status: 'connecting',
          peerName: msg.peerName,
          peerKind: msg.peerKind,
          errorMessage: null
        });
        await this.setupPeerConnection(msg.role === 'initiator');
        break;
      }
      case 'peer-left': {
        this.closePeerOnly();
        this.updateSnapshot({
          status: 'waiting',
          peerName: null,
          peerKind: null,
          transferProgress: null,
          errorMessage: null
        });
        break;
      }
      case 'offer': {
        const pc = await this.ensurePeerConnection(false);
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        await this.flushPendingCandidates(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (answer.sdp) {
          this.sendSignal({ type: 'answer', sdp: answer.sdp });
        }
        break;
      }
      case 'answer': {
        if (!this.pc) return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        await this.flushPendingCandidates(this.pc);
        break;
      }
      case 'ice': {
        if (!this.pc || !this.pc.remoteDescription) {
          this.pendingRemoteCandidates.push(msg.candidate);
        } else {
          try {
            await this.pc.addIceCandidate(msg.candidate);
          } catch {
            // Ignora candidati tardivi non compatibili
          }
        }
        break;
      }
      case 'error': {
        const keepDataChannel = this.dc?.readyState === 'open' && msg.code === 'room_expired';
        if (keepDataChannel) return;
        this.closePeerOnly();
        this.updateSnapshot({
          status: 'error',
          peerName: null,
          peerKind: null,
          errorMessage: msg.message
        });
        break;
      }
      default:
        break;
    }
  }

  private async setupPeerConnection(isInitiator: boolean): Promise<void> {
    const pc = await this.ensurePeerConnection(isInitiator);
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (offer.sdp) {
        this.sendSignal({ type: 'offer', sdp: offer.sdp });
      }
    }
  }

  private async ensurePeerConnection(isInitiator: boolean): Promise<RTCPeerConnection> {
    if (this.pc) return this.pc;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }]
    });
    this.pc = pc;
    this.pendingRemoteCandidates = [];

    this.clearConnectTimeout();
    this.connectTimeoutTimer = setTimeout(() => {
      if (this.pc === pc && this.dc?.readyState !== 'open') {
        this.closePeerOnly();
        this.updateSnapshot({
          status: 'error',
          errorMessage:
            'Il canale P2P non si è aperto entro 25 s (verifica che i dispositivi siano sulla stessa rete o usa Scarica .zip).'
        });
      }
    }, 25_000);

    pc.addEventListener('icecandidate', (ev) => {
      if (this.pc !== pc || !ev.candidate) return;
      this.sendSignal({
        type: 'ice',
        candidate: {
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
          usernameFragment: ev.candidate.usernameFragment
        }
      });
    });

    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc || this.disposed) return;
      if (pc.connectionState === 'failed') {
        this.closePeerOnly();
        this.updateSnapshot({
          status: 'error',
          errorMessage: 'Connessione diretta P2P non riuscita sulla rete corrente.'
        });
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        if (this.snapshot.status === 'connected') {
          this.closePeerOnly();
          this.updateSnapshot({
            status: 'waiting',
            peerName: null,
            peerKind: null,
            transferProgress: null
          });
        }
      }
    });

    if (isInitiator) {
      const dc = pc.createDataChannel('sagitta-map-transfer', { ordered: true });
      this.attachDataChannel(dc);
    } else {
      pc.addEventListener('datachannel', (ev) => {
        if (this.pc !== pc) return;
        this.attachDataChannel(ev.channel);
      });
    }

    return pc;
  }

  private async flushPendingCandidates(pc: RTCPeerConnection): Promise<void> {
    const list = this.pendingRemoteCandidates.splice(0, this.pendingRemoteCandidates.length);
    for (const candidate of list) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Ignora candidati non applicabili
      }
    }
  }

  private attachDataChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 64 * 1024;

    dc.addEventListener('open', () => {
      if (this.dc !== dc || this.disposed) return;
      this.clearConnectTimeout();
      this.updateSnapshot({
        status: 'connected',
        errorMessage: null
      });
    });

    dc.addEventListener('close', () => {
      if (this.dc !== dc || this.disposed) return;
      this.clearConnectTimeout();
      if (this.pendingAckWaiter) {
        this.pendingAckWaiter.reject(new Error('Canale P2P chiuso durante il trasferimento.'));
        this.pendingAckWaiter = null;
      }
      this.receivingState = null;
      this.updateSnapshot({
        status: this.ws && this.ws.readyState === WebSocket.OPEN ? 'waiting' : 'disconnected',
        transferProgress: null
      });
    });

    dc.addEventListener('message', (ev) => {
      if (this.dc !== dc || this.disposed) return;
      void this.handleDataMessage(ev.data);
    });
  }

  private async handleDataMessage(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      const msg = parseDataTransferControlMessage(data);
      if (!msg) return;

      if (msg.kind === 'map-offer') {
        this.receivingState = {
          offer: msg,
          chunks: [],
          receivedBytes: 0
        };
        this.updateSnapshot({
          transferProgress: {
            direction: 'receive',
            title: msg.title,
            bytesDone: 0,
            bytesTotal: msg.byteLength,
            ratio: 0
          },
          errorMessage: null
        });
        return;
      }

      if (msg.kind === 'map-complete') {
        const rec = this.receivingState;
        this.receivingState = null;
        if (!rec || rec.offer.transferId !== msg.transferId) return;

        if (rec.receivedBytes !== rec.offer.byteLength) {
          this.sendControl({
            kind: 'map-ack',
            transferId: msg.transferId,
            accepted: false,
            reason: 'Dimensione pacchetto non corrispondente.'
          });
          this.updateSnapshot({
            transferProgress: null,
            errorMessage: 'Trasferimento incompleto ricevuto dal dispositivo.'
          });
          return;
        }

        const merged = new Uint8Array(rec.offer.byteLength);
        let offset = 0;
        for (const chunk of rec.chunks) {
          merged.set(chunk, offset);
          offset += chunk.byteLength;
        }

        try {
          const digest = await computeSha256Hex(merged);
          if (digest !== rec.offer.sha256) {
            throw new Error('Digest SHA-256 non corrispondente');
          }
        } catch {
          this.sendControl({
            kind: 'map-ack',
            transferId: msg.transferId,
            accepted: false,
            reason: 'Verifica integrità fallita.'
          });
          this.updateSnapshot({
            transferProgress: null,
            errorMessage: 'Il file ricevuto non ha superato il controllo di integrità SHA-256.'
          });
          return;
        }

        this.updateSnapshot({
          transferProgress: null,
          incomingMap: {
            transferId: rec.offer.transferId,
            title: rec.offer.title,
            fileName: rec.offer.fileName,
            senderName: rec.offer.senderName,
            byteLength: rec.offer.byteLength,
            bytes: merged
          }
        });
        return;
      }

      if (msg.kind === 'map-ack' && this.pendingAckWaiter?.transferId === msg.transferId) {
        const waiter = this.pendingAckWaiter;
        this.pendingAckWaiter = null;
        waiter.resolve({ accepted: msg.accepted, reason: msg.reason });
      }
      return;
    }

    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const rec = this.receivingState;
      if (!rec) return;
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (rec.receivedBytes + bytes.byteLength > rec.offer.byteLength) {
        this.receivingState = null;
        this.sendControl({
          kind: 'map-ack',
          transferId: rec.offer.transferId,
          accepted: false,
          reason: 'Superata dimensione dichiarata.'
        });
        this.updateSnapshot({
          transferProgress: null,
          errorMessage: 'Pacchetto ricevuto più grande del dichiarato.'
        });
        return;
      }
      rec.chunks.push(bytes);
      rec.receivedBytes += bytes.byteLength;
      this.updateSnapshot({
        transferProgress: {
          direction: 'receive',
          title: rec.offer.title,
          bytesDone: rec.receivedBytes,
          bytesTotal: rec.offer.byteLength,
          ratio: rec.offer.byteLength > 0 ? rec.receivedBytes / rec.offer.byteLength : 1
        }
      });
    }
  }

  respondToIncoming(accepted: boolean, reason?: string): void {
    const incoming = this.snapshot.incomingMap;
    if (!incoming) return;
    this.sendControl({
      kind: 'map-ack',
      transferId: incoming.transferId,
      accepted,
      ...(reason ? { reason } : {})
    });
    this.updateSnapshot({ incomingMap: null });
  }

  async sendMap(doc: MapDocument, extraAssets?: Map<string, Blob>): Promise<boolean> {
    if (this.sendingBusy) return false;
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') {
      this.updateSnapshot({
        errorMessage: 'Nessun dispositivo collegato: apri «Collega dispositivo» prima di inviare.'
      });
      return false;
    }

    this.sendingBusy = true;
    try {
      this.updateSnapshot({ errorMessage: null, lastSentNotice: null });
      const archiveBytes = await exportProjectArchive(doc, extraAssets);
      if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
        throw new Error('L’archivio della carta supera il limite P2P di 32 MB (usa Scarica .zip).');
      }

      const sha256 = await computeSha256Hex(archiveBytes);
      const transferId = safeRandomUUID();
      const title = doc.manifest.title || 'Carta senza titolo';
      const fileName = buildSafeArchiveFileName(title);

      this.sendControl({
        kind: 'map-offer',
        transferId,
        title,
        fileName,
        byteLength: archiveBytes.byteLength,
        sha256,
        senderName: this.snapshot.deviceName
      });

      this.updateSnapshot({
        transferProgress: {
          direction: 'send',
          title,
          bytesDone: 0,
          bytesTotal: archiveBytes.byteLength,
          ratio: 0
        }
      });

      const ackPromise = new Promise<{ accepted: boolean; reason?: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (this.pendingAckWaiter?.transferId === transferId) {
            this.pendingAckWaiter = null;
            reject(new Error('Tempo scaduto in attesa di conferma dal dispositivo destinatario.'));
          }
        }, 45_000);
        this.pendingAckWaiter = {
          transferId,
          resolve: (res) => {
            clearTimeout(timer);
            resolve(res);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        };
      });

      for (let offset = 0; offset < archiveBytes.byteLength; offset += TRANSFER_CHUNK_BYTES) {
        if (dc.readyState !== 'open') {
          throw new Error('Canale P2P interrotto durante l’invio.');
        }
        while (dc.bufferedAmount > 256 * 1024) {
          await new Promise<void>((resolve) => {
            const onLow = () => {
              dc.removeEventListener('bufferedamountlow', onLow);
              resolve();
            };
            dc.addEventListener('bufferedamountlow', onLow);
            setTimeout(() => {
              dc.removeEventListener('bufferedamountlow', onLow);
              resolve();
            }, 40);
          });
        }
        const end = Math.min(archiveBytes.byteLength, offset + TRANSFER_CHUNK_BYTES);
        dc.send(archiveBytes.slice(offset, end).buffer);
        this.updateSnapshot({
          transferProgress: {
            direction: 'send',
            title,
            bytesDone: end,
            bytesTotal: archiveBytes.byteLength,
            ratio: archiveBytes.byteLength > 0 ? end / archiveBytes.byteLength : 1
          }
        });
      }

      this.sendControl({
        kind: 'map-complete',
        transferId
      });

      const ack = await ackPromise;
      const peerLabel = this.snapshot.peerName || 'dispositivo';
      if (!ack.accepted) {
        this.updateSnapshot({
          transferProgress: null,
          lastSentNotice: ack.reason || `${peerLabel} ha rifiutato la mappa «${title}».`
        });
        return false;
      }

      this.updateSnapshot({
        transferProgress: null,
        lastSentNotice: `Mappa «${title}» ricevuta da ${peerLabel}.`
      });
      return true;
    } catch (err) {
      this.updateSnapshot({
        transferProgress: null,
        errorMessage: err instanceof Error ? err.message : 'Errore durante l’invio della mappa.'
      });
      return false;
    } finally {
      this.sendingBusy = false;
    }
  }

  private sendSignal(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private sendControl(msg: Record<string, unknown>): void {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(msg));
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeoutTimer !== null) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
  }

  private closePeerOnly(): void {
    this.clearConnectTimeout();
    this.receivingState = null;
    if (this.pendingAckWaiter) {
      this.pendingAckWaiter.reject(new Error('Collegamento interrotto.'));
      this.pendingAckWaiter = null;
    }
    if (this.dc) {
      try {
        this.dc.close();
      } catch {
        // Ignora
      }
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // Ignora
      }
      this.pc = null;
    }
    this.pendingRemoteCandidates = [];
  }

  private teardownConnections(): void {
    this.closePeerOnly();
    this.clearPingTimer();
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'bye' }));
        }
        this.ws.close();
      } catch {
        // Ignora
      }
      this.ws = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.teardownConnections();
    this.listeners.clear();
  }
}
