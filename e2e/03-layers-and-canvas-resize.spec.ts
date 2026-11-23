import { expect, test } from '@playwright/test';
import {
  attachErrorTracker,
  clickOnMap,
  createCleanProject,
  dragOnMap,
  inspectCellAtNorm,
  paintIslandCluster
} from './helpers';

test.describe('Core 3: Layers, Custom Layer Routing, Live Canvas Resize & 4 Themes', () => {
  test('manages custom layers, blocks locked layers cleanly, preserves white sheet under hidden terrain, resizes canvas A4->A3 + Undo/Redo, and switches all 4 themes', async ({
    page
  }) => {
    const tracker = attachErrorTracker(page);
    await createCleanProject(page, { title: 'Atlante dei Regni' });
    await paintIslandCluster(page);

    // 1. Open Livelli tab and create a custom layer ("Livello 1")
    await page.getByRole('tab', { name: /^Livelli \(4\)/ }).click();
    await page.getByRole('button', { name: '+ Nuovo livello' }).click();
    await expect(page.getByRole('tab', { name: /^Livelli \(5\)/ })).toBeVisible();

    // Switching to Testo (T) and POI (P) while custom layer is active routes BOTH onto "Livello 1"
    await page.getByRole('button', { name: 'Testo (T)' }).click();
    await clickOnMap(page, 0.48, 0.44);
    const labelInput = page.getByLabel('Nuova etichetta sulla carta');
    await labelInput.fill('Cittadella Alta');
    await labelInput.press('Enter');

    await page.getByRole('button', { name: 'POI (P)' }).click();
    await clickOnMap(page, 0.50, 0.50);

    const customLayerCount = await page.evaluate(() => {
      const doc = window.__MAP_EDITOR_DEBUG__!.getDocument();
      const customLayer = doc.manifest.layers.find((l) => l.name === 'Livello 1');
      if (!customLayer) return -1;
      return doc.manifest.objects.filter((o) => o.layerId === customLayer.id).length;
    });
    expect(customLayerCount).toBe(2);

    // 2. Lock custom layer ("Livello 1") -> blocks new POI placement
    await page.getByRole('tab', { name: /^Livelli \(5\)/ }).click();
    await page.getByRole('button', { name: 'Blocca livello Livello 1' }).click();
    await page.getByRole('button', { name: 'POI (P)' }).click();
    await clickOnMap(page, 0.54, 0.52);
    await expect(page.getByRole('tab', { name: /^Oggetti \(2\)/ })).toBeVisible();

    // 3. Hide & Lock Terreno e Rilievo -> white paper stays visible, terrain strokes blocked cleanly with amber info indicator
    await page.getByRole('tab', { name: /^Livelli \(5\)/ }).click();
    await page.getByRole('button', { name: 'Nascondi livello Terreno e Rilievo' }).click();
    await page.getByRole('button', { name: 'Mostra livello Terreno e Rilievo' }).click();
    await page.getByRole('button', { name: 'Blocca livello Terreno e Rilievo' }).click();

    await page.getByRole('button', { name: 'Terra (B)' }).click();
    const maskBeforeBlockedStroke = (await inspectCellAtNorm(page, 0.15, 0.2)).mask;
    await dragOnMap(page, 0.15, 0.2, 0.22, 0.25, 6);
    const maskAfterBlockedStroke = (await inspectCellAtNorm(page, 0.15, 0.2)).mask;
    expect(maskAfterBlockedStroke).toBe(maskBeforeBlockedStroke);
    await expect(page.locator('.stage-terrain-lock-pill')).toContainText('Livello terreno bloccato');
    await expect(page.locator('.statusbar-icon-info')).toBeVisible();

    // Unlock terrain for further editing
    await page.getByRole('tab', { name: /^Livelli \(5\)/ }).click();
    await page.getByRole('button', { name: 'Sblocca livello Terreno e Rilievo' }).click();

    // 4. Resize Canvas dialog (A4 297x210 -> A3 420x297, Expand/Crop center anchor + Undo/Redo)
    const beforePoiPos = await page.evaluate(() => {
      const poi = window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects.find((o) => o.type === 'stamp');
      return { x: poi!.x, y: poi!.y };
    });

    await page.locator('.topbar-canvas-btn').click();
    const resizeDialog = page.getByRole('dialog', { name: 'Ridimensiona tela' });
    await expect(resizeDialog).toBeVisible();

    const presetSelect = resizeDialog.getByLabel('Formato predefinito');
    await expect(presetSelect.locator('option')).toHaveCount(8); // 7 presets + custom
    await presetSelect.selectOption('a3-landscape');
    await resizeDialog.getByRole('button', { name: 'Applica ridimensionamento' }).click();
    await expect(resizeDialog).toBeHidden();

    await expect(page.locator('.topbar-canvas-label')).toContainText('420×297 mm');
    const shiftedPoiPos = await page.evaluate(() => {
      const poi = window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects.find((o) => o.type === 'stamp');
      return { x: poi!.x, y: poi!.y };
    });
    // Center anchor expands 2970->4200 (+615) and 2100->2970 (+435)
    expect(shiftedPoiPos.x).toBeCloseTo(beforePoiPos.x + 615, 1);
    expect(shiftedPoiPos.y).toBeCloseTo(beforePoiPos.y + 435, 1);

    // Undo resize -> back to 297x210 and original coordinates; Redo -> back to 420x297
    await page.getByRole('button', { name: /^Annulla/ }).click();
    await expect(page.locator('.topbar-canvas-label')).toContainText('297×210 mm');
    await page.getByRole('button', { name: /^Ripristina/ }).click();
    await expect(page.locator('.topbar-canvas-label')).toContainText('420×297 mm');

    // Also test Scale Content mode (420x297 -> 500x500)
    await page.locator('.topbar-canvas-btn').click();
    await resizeDialog.getByLabel('Formato predefinito').selectOption('square-large');
    await resizeDialog.getByRole('button', { name: 'Scala contenuto' }).click();
    await resizeDialog.getByRole('button', { name: 'Applica ridimensionamento' }).click();
    await expect(page.locator('.topbar-canvas-label')).toContainText('500×500 mm');

    // 5. Switch through all 5 themes
    for (const themeName of ['Atlante boreale', 'Regni del Nord', 'Pergamena d’archivio', 'Terra d’ossidiana', 'Carta di stracci classica']) {
      await page.getByRole('button', { name: /^Tema della carta:/ }).click();
      await page.getByRole('menuitemradio', { name: new RegExp(themeName) }).click();
      await expect(page.getByRole('button', { name: `Tema della carta: ${themeName}` })).toBeVisible();
    }

    expect(tracker.errors).toEqual([]);
    tracker.dispose();
  });
});
