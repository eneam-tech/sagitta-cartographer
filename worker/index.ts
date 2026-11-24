import { DurableObject } from 'cloudflare:workers';
import {
  DeviceKindHint,
  MAX_SIGNAL_MESSAGE_BYTES,
  PAIRING_ROOM_TTL_MS,
  formatPairingCode,
  isValidPairingCode,
  normalizePairingCode,
  parseSignalMessage
} from '../src/transfer/protocol';
import { createHoneypotResponse, isHoneypotPath } from './honeypot';
import { applySecurityHeaders, isAllowedOrigin } from './security';
import type { Env } from './env';

interface PeerAttachment {
  peerId: string;
  role: 'initiator' | 'responder' | null;
  deviceName: string | null;
  deviceKind: DeviceKindHint;
  joinedAt: number;
  windowStartMs: number;
  msgCount: number;
}

const RATE_WINDOW_MS = 10_000;
const MAX_MSGS_PER_WINDOW = 50;

function maskRoomTag(roomName?: string): string {
  if (!roomName || roomName.length < 3) return 'unknown';
  return `${roomName.slice(0, 3)}-***`;
}

function logEvent(
  level: 'info' | 'warn',
  event: string,
  fields: Record<string, unknown>
): void {
  const line = JSON.stringify({
    event,
    service: 'sagitta-cartographer',
    timestamp: new Date().toISOString(),
    ...fields
  });
  if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
}

function readAttachment(ws: WebSocket): PeerAttachment | null {
  try {
    const raw = ws.deserializeAttachment() as PeerAttachment | null;
    if (!raw || typeof raw.peerId !== 'string') return null;
    return raw;
  } catch {
    return null;
  }
}

export class PairingRoomDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Richiesta WebSocket non valida.', { status: 426 });
    }

    const activeSockets = this.ctx.getWebSockets();
    if (activeSockets.length >= 2) {
      return new Response('Stanza di abbinamento già completa.', { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const peerId = crypto.randomUUID();
    const now = Date.now();

    const attachment: PeerAttachment = {
      peerId,
      role: null,
      deviceName: null,
      deviceKind: 'desktop',
      joinedAt: now,
      windowStartMs: now,
      msgCount: 0
    };

    this.ctx.acceptWebSocket(server, [peerId]);
    server.serializeAttachment(attachment);

    await this.ctx.storage.setAlarm(now + PAIRING_ROOM_TTL_MS);

    logEvent('info', 'signal_peer_connected', {
      roomTag: maskRoomTag(this.ctx.id.name),
      activePeers: this.ctx.getWebSockets().length,
      ttlMs: PAIRING_ROOM_TTL_MS
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_SIGNAL_MESSAGE_BYTES) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'payload_too_large',
          message: 'Messaggio di segnalazione non valido o troppo grande.'
        })
      );
      return;
    }

    const attachment = readAttachment(ws);
    if (!attachment) {
      ws.close(1011, 'Stato sessione non valido.');
      return;
    }

    const now = Date.now();
    if (now - attachment.windowStartMs > RATE_WINDOW_MS) {
      attachment.windowStartMs = now;
      attachment.msgCount = 0;
    }
    attachment.msgCount += 1;
    if (attachment.msgCount > MAX_MSGS_PER_WINDOW) {
      logEvent('warn', 'signal_rate_limited', {
        roomTag: maskRoomTag(this.ctx.id.name),
        msgCount: attachment.msgCount
      });
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'rate_limited',
          message: 'Troppi messaggi in breve tempo.'
        })
      );
      return;
    }
    ws.serializeAttachment(attachment);

    const parsed = parseSignalMessage(message);
    if (!parsed) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'invalid_message',
          message: 'Formato messaggio di segnalazione non supportato.'
        })
      );
      return;
    }

    if (parsed.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (parsed.type === 'bye') {
      this.notifyPeerLeft(ws, 'Disconnessione richiesta dal dispositivo.');
      ws.close(1000, 'Chiuso dal client.');
      return;
    }

    if (parsed.type === 'hello') {
      attachment.deviceName = parsed.deviceName;
      attachment.deviceKind = parsed.deviceKind;
      ws.serializeAttachment(attachment);

      const peers = this.ctx.getWebSockets();
      const sorted = peers
        .map((sock) => ({ sock, meta: readAttachment(sock) }))
        .filter(
          (entry): entry is { sock: WebSocket; meta: PeerAttachment } => entry.meta !== null
        )
        .sort(
          (a, b) => a.meta.joinedAt - b.meta.joinedAt || a.meta.peerId.localeCompare(b.meta.peerId)
        );

      if (sorted.length === 1) {
        attachment.role = 'initiator';
        ws.serializeAttachment(attachment);
      } else if (sorted.length >= 2) {
        const first = sorted[0];
        const second = sorted[1];
        first.meta.role = 'initiator';
        second.meta.role = 'responder';
        first.sock.serializeAttachment(first.meta);
        second.sock.serializeAttachment(second.meta);

        if (first.meta.deviceName && second.meta.deviceName) {
          first.sock.send(
            JSON.stringify({
              type: 'peer-joined',
              role: 'initiator',
              peerName: second.meta.deviceName,
              peerKind: second.meta.deviceKind
            })
          );
          second.sock.send(
            JSON.stringify({
              type: 'peer-joined',
              role: 'responder',
              peerName: first.meta.deviceName,
              peerKind: first.meta.deviceKind
            })
          );
          logEvent('info', 'signal_peers_matched', {
            roomTag: maskRoomTag(this.ctx.id.name),
            initiatorKind: first.meta.deviceKind,
            responderKind: second.meta.deviceKind
          });
        }
      }

      await this.ctx.storage.setAlarm(now + PAIRING_ROOM_TTL_MS);
      return;
    }

    if (parsed.type === 'offer' || parsed.type === 'answer' || parsed.type === 'ice') {
      const payload = JSON.stringify(parsed);
      for (const peer of this.ctx.getWebSockets()) {
        if (peer !== ws) {
          peer.send(payload);
        }
      }
      await this.ctx.storage.setAlarm(now + PAIRING_ROOM_TTL_MS);
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean
  ): Promise<void> {
    this.notifyPeerLeft(ws, reason || 'Dispositivo disconnesso.');
    try {
      if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) {
        ws.close(code, reason);
      } else {
        ws.close();
      }
    } catch {
      // Socket già chiuso
    }
    const remainingPeers = this.ctx.getWebSockets().filter((peer) => peer !== ws).length;
    logEvent('info', 'signal_peer_disconnected', {
      roomTag: maskRoomTag(this.ctx.id.name),
      remainingPeers,
      code
    });
    if (remainingPeers === 0) {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.notifyPeerLeft(ws, 'Connessione interrotta.');
    try {
      ws.close(1011, 'Errore WebSocket.');
    } catch {
      // Socket già chiuso
    }
  }

  async alarm(): Promise<void> {
    const activeSockets = this.ctx.getWebSockets();
    const closedPeers = activeSockets.length;
    for (const ws of activeSockets) {
      try {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'room_expired',
            message: 'Codice di abbinamento scaduto (5 minuti).'
          })
        );
        ws.close(1000, 'Stanza scaduta.');
      } catch {
        // Ignora errori in chiusura
      }
    }
    await this.ctx.storage.deleteAll();
    logEvent('info', 'signal_room_expired', {
      roomTag: maskRoomTag(this.ctx.id.name),
      closedPeers
    });
  }

  private notifyPeerLeft(leavingWs: WebSocket, reason: string): void {
    const payload = JSON.stringify({ type: 'peer-left', reason });
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== leavingWs) {
        try {
          peer.send(payload);
        } catch {
          // Ignora socket già chiuso
        }
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isHoneypotPath(url.pathname)) {
      const cfInfo = (
        request as Request & { cf?: { country?: string; colo?: string; asn?: number } }
      ).cf;
      logEvent('warn', 'honeypot_hit', {
        path: url.pathname,
        method: request.method,
        country: cfInfo?.country ?? null,
        colo: cfInfo?.colo ?? null,
        asn: cfInfo?.asn ?? null,
        userAgent: (request.headers.get('user-agent') || '').slice(0, 120),
        delayMs: 450
      });
      await new Promise((resolve) => setTimeout(resolve, 450));
      return createHoneypotResponse(url.pathname);
    }

    if (url.pathname === '/api/health') {
      const res = Response.json({
        ok: true,
        service: 'sagitta-cartographer',
        signalEndpoint: '/api/signal'
      });
      applySecurityHeaders(res.headers);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    }

    if (url.pathname === '/api/signal') {
      if (request.method !== 'GET') {
        return new Response('Metodo non consentito.', { status: 405 });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Richiesto upgrade WebSocket.', { status: 426 });
      }
      const origin = request.headers.get('Origin');
      if (!isAllowedOrigin(origin, env.ALLOWED_ORIGINS, url.origin)) {
        logEvent('warn', 'signal_origin_rejected', {
          origin: origin ?? null,
          host: url.host
        });
        return new Response('Origine non autorizzata.', { status: 403 });
      }

      const rawRoom = url.searchParams.get('room') || '';
      if (!isValidPairingCode(rawRoom)) {
        return new Response('Codice di abbinamento non valido.', { status: 400 });
      }

      const normalizedRoom = normalizePairingCode(rawRoom);
      const formattedRoom = formatPairingCode(normalizedRoom);
      const stub = env.PAIRING_ROOMS.getByName(formattedRoom);
      return stub.fetch(request);
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      applySecurityHeaders(headers);
      if (url.pathname === '/sw.js') {
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (url.pathname === '/manifest.webmanifest') {
        headers.set('Content-Type', 'application/manifest+json; charset=utf-8');
      }
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }
};
