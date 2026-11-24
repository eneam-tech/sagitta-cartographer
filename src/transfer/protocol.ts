export const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PAIRING_CODE_RAW_LENGTH = 6;
export const PAIRING_ROOM_TTL_MS = 5 * 60_000;
export const MAX_SIGNAL_MESSAGE_BYTES = 16 * 1024;
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const TRANSFER_CHUNK_BYTES = 16 * 1024;
export const MAX_DEVICE_NAME_LEN = 48;

export type DeviceKindHint = 'ipad' | 'mac' | 'desktop';

export interface SignalHelloMessage {
  type: 'hello';
  deviceName: string;
  deviceKind: DeviceKindHint;
  protocolVersion: 1;
}

export interface SignalPeerJoinedMessage {
  type: 'peer-joined';
  role: 'initiator' | 'responder';
  peerName: string;
  peerKind: DeviceKindHint;
}

export interface SignalPeerLeftMessage {
  type: 'peer-left';
  reason?: string;
}

export interface SignalOfferMessage {
  type: 'offer';
  sdp: string;
}

export interface SignalAnswerMessage {
  type: 'answer';
  sdp: string;
}

export interface SignalIceMessage {
  type: 'ice';
  candidate: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
  };
}

export interface SignalPingMessage {
  type: 'ping';
}

export interface SignalPongMessage {
  type: 'pong';
}

export interface SignalByeMessage {
  type: 'bye';
}

export interface SignalErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export type SignalMessage =
  | SignalHelloMessage
  | SignalPeerJoinedMessage
  | SignalPeerLeftMessage
  | SignalOfferMessage
  | SignalAnswerMessage
  | SignalIceMessage
  | SignalPingMessage
  | SignalPongMessage
  | SignalByeMessage
  | SignalErrorMessage;

export interface DataMapOfferMessage {
  kind: 'map-offer';
  transferId: string;
  title: string;
  fileName: string;
  byteLength: number;
  sha256: string;
  senderName: string;
}

export interface DataMapCompleteMessage {
  kind: 'map-complete';
  transferId: string;
}

export interface DataMapAckMessage {
  kind: 'map-ack';
  transferId: string;
  accepted: boolean;
  reason?: string;
}

export type DataTransferControlMessage =
  | DataMapOfferMessage
  | DataMapCompleteMessage
  | DataMapAckMessage;

export function normalizePairingCode(raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mapped = cleaned
    .replace(/0/g, 'O')
    .replace(/O/g, 'Q')
    .replace(/1/g, 'L')
    .replace(/I/g, 'L');
  return mapped;
}

export function isValidPairingCode(raw: string): boolean {
  const normalized = normalizePairingCode(raw);
  if (normalized.length !== PAIRING_CODE_RAW_LENGTH) return false;
  for (let i = 0; i < normalized.length; i += 1) {
    if (!PAIRING_CODE_ALPHABET.includes(normalized[i])) {
      return false;
    }
  }
  return true;
}

export function formatPairingCode(raw: string): string {
  const normalized = normalizePairingCode(raw);
  if (normalized.length <= 3) return normalized;
  return `${normalized.slice(0, 3)}-${normalized.slice(3, PAIRING_CODE_RAW_LENGTH)}`;
}

export function generatePairingCode(): string {
  const bytes = new Uint8Array(PAIRING_CODE_RAW_LENGTH);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let code = '';
  for (let i = 0; i < PAIRING_CODE_RAW_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return formatPairingCode(code);
}

export function sanitizeDeviceName(raw: unknown, fallback = 'Dispositivo'): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DEVICE_NAME_LEN);
  return trimmed.length > 0 ? trimmed : fallback;
}

export function sanitizeDeviceKind(raw: unknown): DeviceKindHint {
  if (raw === 'ipad' || raw === 'mac' || raw === 'desktop') {
    return raw;
  }
  return 'desktop';
}

export function extractPairingCodeFromQr(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith('sagitta-pair://')) {
    const rest = trimmed.slice('sagitta-pair://'.length).split(/[/?#]/)[0] ?? '';
    return isValidPairingCode(rest) ? formatPairingCode(rest) : null;
  }

  try {
    const url = new URL(trimmed);
    const pairParam = url.searchParams.get('pair');
    if (pairParam && isValidPairingCode(pairParam)) {
      return formatPairingCode(pairParam);
    }
  } catch {
    // Non è un URL completo: prova il match diretto
  }

  return isValidPairingCode(trimmed) ? formatPairingCode(trimmed) : null;
}

export function parseSignalMessage(raw: string): SignalMessage | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_SIGNAL_MESSAGE_BYTES) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const rec = obj as Record<string, unknown>;
  switch (rec.type) {
    case 'hello': {
      return {
        type: 'hello',
        deviceName: sanitizeDeviceName(rec.deviceName),
        deviceKind: sanitizeDeviceKind(rec.deviceKind),
        protocolVersion: 1
      };
    }
    case 'peer-joined': {
      if (rec.role !== 'initiator' && rec.role !== 'responder') return null;
      return {
        type: 'peer-joined',
        role: rec.role,
        peerName: sanitizeDeviceName(rec.peerName),
        peerKind: sanitizeDeviceKind(rec.peerKind)
      };
    }
    case 'peer-left': {
      return {
        type: 'peer-left',
        ...(typeof rec.reason === 'string' ? { reason: rec.reason.slice(0, 120) } : {})
      };
    }
    case 'offer': {
      if (typeof rec.sdp !== 'string' || rec.sdp.length === 0 || rec.sdp.length > 14_000) {
        return null;
      }
      return { type: 'offer', sdp: rec.sdp };
    }
    case 'answer': {
      if (typeof rec.sdp !== 'string' || rec.sdp.length === 0 || rec.sdp.length > 14_000) {
        return null;
      }
      return { type: 'answer', sdp: rec.sdp };
    }
    case 'ice': {
      const c = rec.candidate;
      if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
      const candRec = c as Record<string, unknown>;
      if (typeof candRec.candidate !== 'string' || candRec.candidate.length > 1024) {
        return null;
      }
      return {
        type: 'ice',
        candidate: {
          candidate: candRec.candidate,
          sdpMid: typeof candRec.sdpMid === 'string' ? candRec.sdpMid.slice(0, 64) : null,
          sdpMLineIndex:
            typeof candRec.sdpMLineIndex === 'number' && Number.isInteger(candRec.sdpMLineIndex)
              ? candRec.sdpMLineIndex
              : null,
          usernameFragment:
            typeof candRec.usernameFragment === 'string'
              ? candRec.usernameFragment.slice(0, 128)
              : null
        }
      };
    }
    case 'ping':
      return { type: 'ping' };
    case 'pong':
      return { type: 'pong' };
    case 'bye':
      return { type: 'bye' };
    case 'error': {
      return {
        type: 'error',
        code: typeof rec.code === 'string' ? rec.code.slice(0, 64) : 'error',
        message: typeof rec.message === 'string' ? rec.message.slice(0, 240) : 'Errore di rete.'
      };
    }
    default:
      return null;
  }
}

export function parseDataTransferControlMessage(raw: string): DataTransferControlMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;

  if (rec.kind === 'map-offer') {
    if (
      typeof rec.transferId !== 'string' ||
      rec.transferId.length === 0 ||
      rec.transferId.length > 64 ||
      typeof rec.title !== 'string' ||
      typeof rec.fileName !== 'string' ||
      typeof rec.byteLength !== 'number' ||
      !Number.isInteger(rec.byteLength) ||
      rec.byteLength <= 0 ||
      rec.byteLength > MAX_ARCHIVE_BYTES ||
      typeof rec.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(rec.sha256)
    ) {
      return null;
    }
    return {
      kind: 'map-offer',
      transferId: rec.transferId,
      title: rec.title.slice(0, 120) || 'Carta senza titolo',
      fileName: rec.fileName.replace(/[/\\:*?"<>|]/g, '_').slice(0, 128) || 'carta.zip',
      byteLength: rec.byteLength,
      sha256: rec.sha256.toLowerCase(),
      senderName: sanitizeDeviceName(rec.senderName)
    };
  }

  if (rec.kind === 'map-complete') {
    if (typeof rec.transferId !== 'string' || rec.transferId.length === 0) return null;
    return { kind: 'map-complete', transferId: rec.transferId.slice(0, 64) };
  }

  if (rec.kind === 'map-ack') {
    if (typeof rec.transferId !== 'string' || typeof rec.accepted !== 'boolean') return null;
    return {
      kind: 'map-ack',
      transferId: rec.transferId.slice(0, 64),
      accepted: rec.accepted,
      ...(typeof rec.reason === 'string' ? { reason: rec.reason.slice(0, 160) } : {})
    };
  }

  return null;
}

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto SHA-256 non disponibile in questo contesto.');
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await subtle.digest('SHA-256', copy.buffer);
  const out = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < out.length; i += 1) {
    hex += out[i].toString(16).padStart(2, '0');
  }
  return hex;
}
