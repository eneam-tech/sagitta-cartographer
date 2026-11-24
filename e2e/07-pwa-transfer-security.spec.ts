import { expect, test } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  attachErrorTracker,
  createCleanProject,
  waitForEditorReady
} from './helpers';

test.describe('Suite E2E 7 — PWA Sagitta - Cartografo, Honeypot e Collega Dispositivo P2P', () => {
  test('verifica branding Sagitta, manifest e icone, honeypot sintetici e modale Collega dispositivo', async ({
    page,
    request
  }) => {
    const tracker = attachErrorTracker(page);

    try {
      await page.addInitScript(() => {
        const NativeWebSocket = window.WebSocket;
        class MockSignalWebSocket extends EventTarget {
          static readonly CONNECTING = 0;
          static readonly OPEN = 1;
          static readonly CLOSING = 2;
          static readonly CLOSED = 3;

          readonly CONNECTING = 0;
          readonly OPEN = 1;
          readonly CLOSING = 2;
          readonly CLOSED = 3;

          readonly url: string;
          readyState = 0;
          onopen: ((ev: Event) => unknown) | null = null;
          onmessage: ((ev: MessageEvent) => unknown) | null = null;
          onerror: ((ev: Event) => unknown) | null = null;
          onclose: ((ev: CloseEvent) => unknown) | null = null;

          private openTimer: number | null = null;

          constructor(url: string | URL) {
            super();
            this.url = String(url);
            this.openTimer = window.setTimeout(() => {
              if (this.readyState !== 0) return;
              this.readyState = 1;
              const openEv = new Event('open');
              this.onopen?.(openEv);
              this.dispatchEvent(openEv);
            }, 10);
          }

          send(raw: string): void {
            if (this.readyState !== 1) return;
            try {
              const parsed = JSON.parse(raw) as { type?: string };
              if (parsed.type === 'ping') {
                window.setTimeout(() => {
                  if (this.readyState !== 1) return;
                  const msgEv = new MessageEvent('message', {
                    data: JSON.stringify({ type: 'pong' })
                  });
                  this.onmessage?.(msgEv);
                  this.dispatchEvent(msgEv);
                }, 5);
              }
            } catch {
              // ignora payload non JSON nel mock di test
            }
          }

          close(): void {
            if (this.openTimer !== null) {
              window.clearTimeout(this.openTimer);
              this.openTimer = null;
            }
            if (this.readyState === 3) return;
            this.readyState = 3;
            const closeEv = new CloseEvent('close');
            this.onclose?.(closeEv);
            this.dispatchEvent(closeEv);
          }
        }

        const WrappedWebSocket = function (
          this: unknown,
          url: string | URL,
          protocols?: string | string[]
        ) {
          const urlStr = String(url);
          if (urlStr.includes('/api/signal')) {
            return new MockSignalWebSocket(urlStr) as unknown as WebSocket;
          }
          return protocols === undefined
            ? new NativeWebSocket(url)
            : new NativeWebSocket(url, protocols);
        } as unknown as typeof WebSocket;

        Object.assign(WrappedWebSocket, {
          CONNECTING: NativeWebSocket.CONNECTING,
          OPEN: NativeWebSocket.OPEN,
          CLOSING: NativeWebSocket.CLOSING,
          CLOSED: NativeWebSocket.CLOSED
        });
        WrappedWebSocket.prototype = NativeWebSocket.prototype;
        window.WebSocket = WrappedWebSocket;
      });

      await createCleanProject(page, { title: 'Carta Sagitta E2E' });

      // 1. Titolo e manifesto PWA "Sagitta - Cartografo"
      await expect(page).toHaveTitle(/Sagitta - Cartografo/);
      await assertNoHorizontalOverflow(page);

      const manifestRes = await request.get('/manifest.webmanifest');
      expect(manifestRes.status()).toBe(200);
      const manifestJson = await manifestRes.json();
      expect(manifestJson.name).toBe('Sagitta - Cartografo');
      expect(manifestJson.short_name).toBe('Sagitta');
      expect(Array.isArray(manifestJson.icons)).toBe(true);

      for (const iconPath of ['/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png']) {
        const iconRes = await request.get(iconPath);
        expect(iconRes.status()).toBe(200);
        expect(iconRes.headers()['content-type']).toContain('image/png');
      }

      // 2. Verifica file honeypot sintetici e robots.txt
      const apiKeyRes = await request.get('/X-API-KEY.json');
      expect(apiKeyRes.status()).toBe(200);
      const apiKeyJson = await apiKeyRes.json();
      expect(apiKeyJson['x-api-key']).toContain('SAGITTA-CANARY-');

      const passwordRes = await request.get('/password.txt');
      expect(passwordRes.status()).toBe(200);
      expect(await passwordRes.text()).toContain('honeypot_warden');

      const robotsRes = await request.get('/robots.txt');
      expect(robotsRes.status()).toBe(200);
      expect(await robotsRes.text()).toContain('Disallow: /X-API-KEY.json');

      // 3. Apertura modale "Collega dispositivo…" da Progetto -> rinomina + genera codice e QR
      await page.getByRole('button', { name: 'Menu progetto' }).click();
      await page.getByRole('menuitem', { name: /Collega dispositivo/ }).click();

      const transferDialog = page.getByRole('dialog', { name: 'Collega dispositivo (P2P Wi-Fi)' });
      await expect(transferDialog).toBeVisible();

      const deviceInput = transferDialog.getByLabel('Nome di questo dispositivo');
      await deviceInput.fill('MacBook Studio Prova');
      await transferDialog.getByRole('button', { name: 'Salva', exact: true }).click();

      await transferDialog.getByRole('button', { name: 'Genera codice e QR temporaneo' }).click();
      const codeBox = transferDialog.locator('.transfer-code-display');
      await expect(codeBox).toBeVisible();
      const generatedCode = (await codeBox.textContent())?.trim() ?? '';
      expect(generatedCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{3}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{3}$/);

      await expect(transferDialog.locator('.transfer-qr-frame svg')).toBeVisible();

      // Cambio scheda su inserimento codice manuale + fotocamera QR
      await transferDialog.getByRole('tab', { name: 'Inserisci codice o scansiona' }).click();
      await expect(transferDialog.getByLabel(/Codice a 6 caratteri/)).toBeVisible();
      await expect(transferDialog.getByRole('button', { name: 'Scansiona QR nell’app' })).toBeVisible();

      await transferDialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
      await expect(transferDialog).toBeHidden();

      // 4. Ricarica con ?pair=... apre direttamente la modale con codice acquisito (poi ripulito da URL)
      await page.goto('/?pair=K7M-9PX');
      await waitForEditorReady(page);
      const pairedDialog = page.getByRole('dialog', { name: 'Collega dispositivo (P2P Wi-Fi)' });
      await expect(pairedDialog).toBeVisible();
      await expect(pairedDialog.locator('.transfer-code-display')).toHaveText('K7M-9PX');
      expect(page.url()).not.toContain('pair=');

      // 5. Controllo overflow su viewport iPad e mobile compatto
      await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
      await page.setViewportSize({ width: 820, height: 1180 });
      await assertNoHorizontalOverflow(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await assertNoHorizontalOverflow(page);

      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });
});
