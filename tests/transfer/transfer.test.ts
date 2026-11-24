import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import jsQR from 'jsqr';
import { createEmptyDocument } from '../../src/model/document';
import { EditorStore } from '../../src/state/editorStore';
import { PeerTransferManager } from '../../src/transfer/peerTransfer';
import {
  MAX_SIGNAL_MESSAGE_BYTES,
  extractPairingCodeFromQr,
  formatPairingCode,
  generatePairingCode,
  isValidPairingCode,
  parseDataTransferControlMessage,
  parseSignalMessage,
  sanitizeDeviceName
} from '../../src/transfer/protocol';
import { buildPairingQrPayload, encodePairingQrMatrix } from '../../src/transfer/qrCode';
import { DeviceTransferDialog } from '../../src/ui/DeviceTransferDialog';
import { DialogsHost } from '../../src/ui/Dialogs';
import { TopBar } from '../../src/ui/TopBar';
import { createHoneypotResponse, isHoneypotPath } from '../../worker/honeypot';
import { applySecurityHeaders, isAllowedOrigin } from '../../worker/security';

describe('Trasferimento P2P, QR e sicurezza Cloudflare', () => {
  it('genera e valida codici di abbinamento non ambigui e QR decodificabili end-to-end', () => {
    for (let i = 0; i < 12; i += 1) {
      const code = generatePairingCode();
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{3}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{3}$/);
      expect(isValidPairingCode(code)).toBe(true);
    }

    expect(formatPairingCode('k7m9px')).toBe('K7M-9PX');
    expect(isValidPairingCode('K7M-9PX')).toBe(true);
    expect(isValidPairingCode('12')).toBe(false);

    const payload = buildPairingQrPayload('K7M-9PX', 'https://em-sagitta-cartografo.pages.dev');
    expect(payload).toBe('https://em-sagitta-cartografo.pages.dev/?pair=K7M-9PX');
    expect(extractPairingCodeFromQr(payload)).toBe('K7M-9PX');
    expect(extractPairingCodeFromQr('sagitta-pair://R4T-8NW')).toBe('R4T-8NW');
    expect(extractPairingCodeFromQr('https://evil.example/?nope=1')).toBeNull();

    // Round-trip reale: genera QR con uqr -> renderizza RGBA in memoria -> decodifica con jsQR
    const matrix = encodePairingQrMatrix(payload);
    const scale = 4;
    const dim = matrix.size * scale;
    const rgba = new Uint8ClampedArray(dim * dim * 4);
    for (let y = 0; y < matrix.size; y += 1) {
      for (let x = 0; x < matrix.size; x += 1) {
        const v = matrix.data[y][x] ? 15 : 245;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const idx = ((y * scale + dy) * dim + (x * scale + dx)) * 4;
            rgba[idx] = v;
            rgba[idx + 1] = v;
            rgba[idx + 2] = v;
            rgba[idx + 3] = 255;
          }
        }
      }
    }
    const decoded = jsQR(rgba, dim, dim);
    expect(decoded?.data).toBe(payload);
  });

  it('valida rigorosamente i messaggi di segnalazione WebRTC e controllo DataChannel', () => {
    expect(
      parseSignalMessage(
        JSON.stringify({
          type: 'hello',
          deviceName: '  iPad   <script> ',
          deviceKind: 'ipad',
          protocolVersion: 1
        })
      )
    ).toEqual({
      type: 'hello',
      deviceName: 'iPad script',
      deviceKind: 'ipad',
      protocolVersion: 1
    });

    expect(sanitizeDeviceName('   ', 'Fallback')).toBe('Fallback');
    expect(parseSignalMessage('not-json')).toBeNull();
    expect(parseSignalMessage(JSON.stringify({ type: 'eval', cmd: 'rm -rf' }))).toBeNull();
    expect(parseSignalMessage('x'.repeat(MAX_SIGNAL_MESSAGE_BYTES + 1))).toBeNull();

    const validOffer = parseDataTransferControlMessage(
      JSON.stringify({
        kind: 'map-offer',
        transferId: 'tx-1',
        title: 'Contea Nord',
        fileName: '../malevolo.zip',
        byteLength: 4096,
        sha256: 'a'.repeat(64),
        senderName: 'Mac'
      })
    );
    expect(validOffer).toMatchObject({
      kind: 'map-offer',
      fileName: '.._malevolo.zip',
      byteLength: 4096
    });

    expect(
      parseDataTransferControlMessage(
        JSON.stringify({
          kind: 'map-offer',
          transferId: 'tx-bad',
          title: 'Troppo grande',
          fileName: 'big.zip',
          byteLength: 64 * 1024 * 1024,
          sha256: 'a'.repeat(64),
          senderName: 'Mac'
        })
      )
    ).toBeNull();
  });

  it('riconosce gli honeypot edge con token sintetici innocui e verifica CSP/CORS allowlist', async () => {
    expect(isHoneypotPath('/X-API-KEY.json')).toBe(true);
    expect(isHoneypotPath('/password.txt')).toBe(true);
    expect(isHoneypotPath('/secrets-config.json')).toBe(true);
    expect(isHoneypotPath('/.env.production')).toBe(true);
    expect(isHoneypotPath('/wp-login.php')).toBe(true);
    expect(isHoneypotPath('/.git/config')).toBe(true);
    expect(isHoneypotPath('/index.html')).toBe(false);
    expect(isHoneypotPath('/api/signal')).toBe(false);

    const apiKeyRes = createHoneypotResponse('/X-API-KEY.json');
    expect(apiKeyRes.status).toBe(200);
    expect(apiKeyRes.headers.get('X-Robots-Tag')).toContain('noindex');
    const apiKeyBody = await apiKeyRes.text();
    expect(apiKeyBody).toContain('SAGITTA-CANARY-');
    expect(apiKeyBody).not.toMatch(/AKIA|ghp_|AIza|xoxb-|sk-live/);

    const passRes = createHoneypotResponse('/password.txt');
    const passBody = await passRes.text();
    expect(passBody).toContain('sagitta-canary-pass-');

    // Origin allowlist
    expect(isAllowedOrigin('https://sagitta-cartographer.eneaminelli.workers.dev')).toBe(true);
    expect(isAllowedOrigin('https://pr-12-sagitta-cartographer.eneaminelli.workers.dev')).toBe(true);
    expect(isAllowedOrigin('https://sagitta-cartographer.pages.dev')).toBe(true);
    expect(
      isAllowedOrigin('https://mappe.esempio.it', undefined, 'https://mappe.esempio.it')
    ).toBe(true);
    expect(
      isAllowedOrigin('https://evil.example', undefined, 'https://mappe.esempio.it')
    ).toBe(false);
    expect(isAllowedOrigin('https://em-sagitta-cartografo.pages.dev')).toBe(true);
    expect(isAllowedOrigin('https://preview-123.em-sagitta-cartografo.pages.dev')).toBe(true);
    expect(isAllowedOrigin('https://em-sagitta-cartografo.eneaminelli.workers.dev')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://192.168.68.56:5173')).toBe(true);
    expect(isAllowedOrigin('http://MacBook-Pro-di-Enea.local:5173')).toBe(true);
    expect(isAllowedOrigin('https://attacker.example')).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);

    const headers = applySecurityHeaders(new Headers());
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Content-Security-Policy')).toContain("object-src 'none'");
  });

  it('rende DeviceTransferDialog accessibile e coerente con la tipografia UI', () => {
    const store = new EditorStore({
      initialDocument: createEmptyDocument({ title: 'Sagitta Prova' })
    });
    const peerManager = new PeerTransferManager();
    peerManager.setDeviceName('iPad di Enea');
    store.openDialog('deviceTransfer');

    const dialogHtml = renderToStaticMarkup(createElement(DeviceTransferDialog, { store, peerManager }));
    const hostHtml = renderToStaticMarkup(createElement(DialogsHost, { store, peerManager }));
    const topHtml = renderToStaticMarkup(createElement(TopBar, { store, peerManager }));

    expect(dialogHtml).toContain('Collega dispositivo (P2P Wi-Fi)');
    expect(dialogHtml).toContain('iPad di Enea');
    expect(dialogHtml).toContain('Genera codice e QR temporaneo');
    expect(hostHtml).toContain('Collega dispositivo (P2P Wi-Fi)');
    expect(topHtml).toContain('Solo penna');

    for (const html of [dialogHtml, hostHtml, topHtml]) {
      expect(html).not.toContain('font-size:11px');
      expect(html).not.toContain('font-size:12px');
      expect(html).not.toContain('font-size:14px');
    }

    peerManager.dispose();
    store.dispose();
  });
});
