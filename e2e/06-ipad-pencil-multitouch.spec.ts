import { expect, Page, test } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  attachErrorTracker,
  createCleanProject,
  getViewportClientCoords,
  inspectCellAtNorm,
  setBrushDiameter
} from './helpers';

async function dispatchPointerEvent(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  opts: {
    clientX: number;
    clientY: number;
    pointerId: number;
    pointerType: 'touch' | 'pen' | 'mouse';
    pressure?: number;
    buttons?: number;
    button?: number;
  }
): Promise<void> {
  await page.evaluate(
    ({ eventType, payload }) => {
      const el = document.querySelector('[aria-label="Area di lavoro della carta"]');
      if (!el) throw new Error('Area di lavoro della carta non trovata');
      const evt = new PointerEvent(eventType, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: payload.clientX,
        clientY: payload.clientY,
        pointerId: payload.pointerId,
        pointerType: payload.pointerType,
        isPrimary: payload.pointerId <= 1,
        pressure: payload.pressure ?? (eventType === 'pointerup' ? 0 : 0.5),
        button: payload.button ?? (eventType === 'pointermove' ? -1 : 0),
        buttons: payload.buttons ?? (eventType === 'pointerup' || eventType === 'pointercancel' ? 0 : 1)
      });
      el.dispatchEvent(evt);
    },
    { eventType: type, payload: opts }
  );
}

test.describe('Suite E2E 6 — iPad, Apple Pencil e Multi-Touch', () => {
  test('layout iPad landscape/portrait, Solo penna, palm rejection, pinch-zoom, tap undo/redo e pressione', async ({
    browser
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1180, height: 820 },
      hasTouch: true,
      isMobile: true
    });
    const page = await context.newPage();
    const tracker = attachErrorTracker(page);

    try {
      await createCleanProject(page, { title: 'Carta iPad Prova' });
      await assertNoHorizontalOverflow(page);

      // 1. Verifica UI iPad: pulsante Solo penna in barra superiore e sezione proprietà Apple Pencil
      const pencilToggle = page.getByRole('button', { name: /Solo Apple Pencil/i });
      await expect(pencilToggle).toBeVisible();
      await expect(pencilToggle).toHaveAttribute('aria-pressed', 'false');

      const propGroup = page.getByLabel('Controlli Apple Pencil e tocco');
      await expect(propGroup).toBeVisible();
      await expect(propGroup.getByLabel(/Solo Apple Pencil/i)).not.toBeChecked();
      await expect(propGroup.getByLabel(/Sensibilità pressione Apple Pencil/i)).toBeChecked();

      // Verifica guida gesti iPad nella finestra Scorciatoie
      await page.getByRole('button', { name: 'Scorciatoie da tastiera (?)' }).click();
      const shortcutsDialog = page.getByRole('dialog', { name: 'Scorciatoie da tastiera' });
      await expect(shortcutsDialog).toBeVisible();
      await expect(shortcutsDialog).toContainText('Gesti iPad e Apple Pencil');
      await expect(shortcutsDialog).toContainText('Tocco 2 dita');
      await expect(shortcutsDialog).toContainText('Tocco 3 dita');
      await shortcutsDialog.getByRole('button', { name: 'Chiudi', exact: true }).click();
      await expect(shortcutsDialog).toBeHidden();

      // 2. Attiva "Solo Apple Pencil": 1 dito sposta la vista (pan) senza disegnare terra
      await pencilToggle.click();
      await expect(pencilToggle).toHaveAttribute('aria-pressed', 'true');
      await expect(propGroup.getByLabel(/Solo Apple Pencil/i)).toBeChecked();

      const camBeforePan = await page.evaluate(
        () => window.__MAP_EDITOR_DEBUG__!.store.getSnapshot().camera
      );
      const touchStart = await getViewportClientCoords(page, 0.35, 0.5);
      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: touchStart.x,
        clientY: touchStart.y,
        pointerId: 11,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointermove', {
        clientX: touchStart.x + 80,
        clientY: touchStart.y + 40,
        pointerId: 11,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: touchStart.x + 80,
        clientY: touchStart.y + 40,
        pointerId: 11,
        pointerType: 'touch'
      });

      const afterFingerPan = await page.evaluate(() => {
        const snap = window.__MAP_EDITOR_DEBUG__!.store.getSnapshot();
        const mask = snap.doc.terrain.mask;
        let hasAnyLand = false;
        for (let i = 0; i < mask.length; i += 1) {
          if (mask[i] > 0) {
            hasAnyLand = true;
            break;
          }
        }
        return { camera: snap.camera, hasLand: hasAnyLand };
      });
      expect(afterFingerPan.hasLand).toBe(false);
      expect(afterFingerPan.camera.offsetX).toBeGreaterThan(camBeforePan.offsetX + 50);
      expect(afterFingerPan.camera.offsetY).toBeGreaterThan(camBeforePan.offsetY + 25);

      // Torna alla vista intera prima del disegno Apple Pencil
      await page.getByRole('button', { name: 'Adatta alla finestra' }).click();

      // 3. Disegno con Apple Pencil + Palm Rejection attiva durante il tratto
      await page.getByRole('button', { name: 'Terra (B)' }).click();
      await setBrushDiameter(page, 260);
      const penPt1 = await getViewportClientCoords(page, 0.42, 0.48);
      const penPt2 = await getViewportClientCoords(page, 0.58, 0.48);
      const palmPt = await getViewportClientCoords(page, 0.78, 0.72);

      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: penPt1.x,
        clientY: penPt1.y,
        pointerId: 1,
        pointerType: 'pen',
        pressure: 0.85
      });

      // Mentre la Apple Pencil tocca lo schermo, il palmo (touch) cade altrove e viene ignorato
      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: palmPt.x,
        clientY: palmPt.y,
        pointerId: 22,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointermove', {
        clientX: palmPt.x + 15,
        clientY: palmPt.y + 10,
        pointerId: 22,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: palmPt.x + 15,
        clientY: palmPt.y + 10,
        pointerId: 22,
        pointerType: 'touch'
      });

      // Prosegue il tratto Apple Pencil fino a penPt2
      await dispatchPointerEvent(page, 'pointermove', {
        clientX: penPt2.x,
        clientY: penPt2.y,
        pointerId: 1,
        pointerType: 'pen',
        pressure: 0.85
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: penPt2.x,
        clientY: penPt2.y,
        pointerId: 1,
        pointerType: 'pen',
        pressure: 0
      });

      const penCell = await inspectCellAtNorm(page, 0.5, 0.48);
      const palmCell = await inspectCellAtNorm(page, 0.78, 0.72);
      expect(penCell.mask).toBeGreaterThan(0);
      expect(palmCell.mask).toBe(0);

      // 4. Disattiva Solo penna -> verifica Multi-Touch: pinch-zoom a 2 dita + annulla tratto accidentale <150ms
      await pencilToggle.click();
      await expect(pencilToggle).toHaveAttribute('aria-pressed', 'false');

      const camBeforePinch = await page.evaluate(
        () => window.__MAP_EDITOR_DEBUG__!.store.getSnapshot().camera
      );
      const smudgePt = await getViewportClientCoords(page, 0.2, 0.78);
      const f1Start = smudgePt;
      const f2Start = { x: smudgePt.x + 80, y: smudgePt.y };

      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: f1Start.x,
        clientY: f1Start.y,
        pointerId: 31,
        pointerType: 'touch'
      });
      // Secondo dito atterra entro <150ms: avvia pinch e cancella l'inizio accidentale del tocco singolo
      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: f2Start.x,
        clientY: f2Start.y,
        pointerId: 32,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointermove', {
        clientX: f1Start.x - 40,
        clientY: f1Start.y,
        pointerId: 31,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointermove', {
        clientX: f2Start.x + 40,
        clientY: f2Start.y,
        pointerId: 32,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: f1Start.x - 40,
        clientY: f1Start.y,
        pointerId: 31,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: f2Start.x + 40,
        clientY: f2Start.y,
        pointerId: 32,
        pointerType: 'touch'
      });

      const afterPinch = await page.evaluate(() => ({
        camera: window.__MAP_EDITOR_DEBUG__!.store.getSnapshot().camera,
        smudgeCheck: (() => {
          const doc = window.__MAP_EDITOR_DEBUG__!.getDocument();
          const { widthPx, heightPx, mask } = doc.terrain;
          const px = Math.round(0.2 * widthPx);
          const py = Math.round(0.78 * heightPx);
          return mask[py * widthPx + px];
        })()
      }));
      expect(afterPinch.camera.scale).toBeGreaterThan(camBeforePinch.scale * 1.4);
      expect(afterPinch.smudgeCheck).toBe(0);

      // Re-fit vista e verifica tocco a 2 dita = Annulla, tocco a 3 dita = Ripristina
      await page.getByRole('button', { name: 'Adatta alla finestra' }).click();
      expect((await inspectCellAtNorm(page, 0.5, 0.48)).mask).toBeGreaterThan(0);

      const tapCenter = await getViewportClientCoords(page, 0.5, 0.5);
      // 2-finger tap -> Undo
      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: tapCenter.x - 20,
        clientY: tapCenter.y,
        pointerId: 41,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: tapCenter.x + 20,
        clientY: tapCenter.y,
        pointerId: 42,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: tapCenter.x - 20,
        clientY: tapCenter.y,
        pointerId: 41,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: tapCenter.x + 20,
        clientY: tapCenter.y,
        pointerId: 42,
        pointerType: 'touch'
      });
      expect((await inspectCellAtNorm(page, 0.5, 0.48)).mask).toBe(0);

      // 3-finger tap -> Redo
      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: tapCenter.x - 30,
        clientY: tapCenter.y,
        pointerId: 51,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: tapCenter.x,
        clientY: tapCenter.y,
        pointerId: 52,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: tapCenter.x + 30,
        clientY: tapCenter.y,
        pointerId: 53,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: tapCenter.x - 30,
        clientY: tapCenter.y,
        pointerId: 51,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: tapCenter.x,
        clientY: tapCenter.y,
        pointerId: 52,
        pointerType: 'touch'
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: tapCenter.x + 30,
        clientY: tapCenter.y,
        pointerId: 53,
        pointerType: 'touch'
      });
      expect((await inspectCellAtNorm(page, 0.5, 0.48)).mask).toBeGreaterThan(0);

      // 5. Differenziazione pressione Apple Pencil su Rilievo (0.15 vs 0.95)
      await page.getByRole('button', { name: 'Rilievo (E)' }).click();
      await setBrushDiameter(page, 180);
      const lightElevPt = await getViewportClientCoords(page, 0.44, 0.48);
      const heavyElevPt = await getViewportClientCoords(page, 0.56, 0.48);
      const lightBefore = (await inspectCellAtNorm(page, 0.44, 0.48)).height;
      const heavyBefore = (await inspectCellAtNorm(page, 0.56, 0.48)).height;

      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: lightElevPt.x,
        clientY: lightElevPt.y,
        pointerId: 2,
        pointerType: 'pen',
        pressure: 0.15
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: lightElevPt.x,
        clientY: lightElevPt.y,
        pointerId: 2,
        pointerType: 'pen',
        pressure: 0
      });

      await dispatchPointerEvent(page, 'pointerdown', {
        clientX: heavyElevPt.x,
        clientY: heavyElevPt.y,
        pointerId: 3,
        pointerType: 'pen',
        pressure: 0.95
      });
      await dispatchPointerEvent(page, 'pointerup', {
        clientX: heavyElevPt.x,
        clientY: heavyElevPt.y,
        pointerId: 3,
        pointerType: 'pen',
        pressure: 0
      });

      const lightDelta = (await inspectCellAtNorm(page, 0.44, 0.48)).height - lightBefore;
      const heavyDelta = (await inspectCellAtNorm(page, 0.56, 0.48)).height - heavyBefore;
      expect(lightDelta).toBeGreaterThan(0);
      expect(heavyDelta).toBeGreaterThan(lightDelta);

      // 6. Rotazione iPad Portrait (820x1180): zero overflow e accesso ai controlli Apple Pencil nel cassetto Proprietà
      await page.setViewportSize({ width: 820, height: 1180 });
      await assertNoHorizontalOverflow(page);
      await expect(pencilToggle).toBeVisible();

      const propsToggle = page.getByRole('button', { name: 'Apri o chiudi pannello proprietà' });
      await expect(propsToggle).toBeVisible();
      await propsToggle.click();
      await expect(propGroup).toBeVisible();

      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
      await context.close();
    }
  });
});
