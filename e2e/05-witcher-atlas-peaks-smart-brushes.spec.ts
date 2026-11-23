import { expect, test } from '@playwright/test';
import {
  attachErrorTracker,
  clickOnMap,
  createCleanProject,
  dragOnMap,
  inspectCellAtNorm,
  setBrushDiameter
} from './helpers';

test.describe('Core 5: Witcher 3 Atlas, Procedural Generator, Peaked Mountains & Smart Brushes', () => {
  test('generates Northern Realms continent, sculpts peaked mountains + plateau + smart coasts, auto-labels POIs, and renders atlas preview', async ({
    page
  }) => {
    const tracker = attachErrorTracker(page);
    await createCleanProject(page, { title: 'Regni del Nord' });

    // 1. Generate continent via TopBar "Genera…" modal
    await page.getByRole('button', { name: 'Genera continente procedurale' }).click();
    const genDialog = page.getByRole('dialog', { name: 'Genera continente' });
    await expect(genDialog).toBeVisible();

    await genDialog
      .getByRole('group', { name: 'Modello di continente' })
      .getByRole('button', { name: /Regni del Nord \(The Witcher 3\)/ })
      .click();
    await genDialog.getByLabel('Seme procedurale (Seed)').fill('4219');
    const themeToggle = genDialog.getByLabel(/Applica tema «Regni del Nord»/);
    if (!(await themeToggle.isChecked())) {
      await themeToggle.check();
    }
    await genDialog.getByRole('button', { name: 'Genera continente' }).click();
    await expect(genDialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Tema della carta: Regni del Nord' })).toBeVisible();

    const statsAfterGen = await page.evaluate(() => {
      const doc = window.__MAP_EDITOR_DEBUG__!.getDocument();
      const { mask, height, cover } = doc.terrain;
      let land = 0;
      let sea = 0;
      let maxH = 0;
      const coverSet = new Set<number>();
      for (let i = 0; i < mask.length; i += 8) {
        if (mask[i] >= 128) {
          land += 1;
          if (height[i] > maxH) maxH = height[i];
          coverSet.add(cover[i]);
        } else {
          sea += 1;
        }
      }
      return { land, sea, maxH, coverCount: coverSet.size };
    });
    expect(statsAfterGen.land).toBeGreaterThan(200);
    expect(statsAfterGen.sea).toBeGreaterThan(200);
    expect(statsAfterGen.maxH).toBeGreaterThan(150);
    expect(statsAfterGen.coverCount).toBeGreaterThanOrEqual(3);

    // 1-step Undo clears back to ocean; Redo restores entire continent
    await page.getByRole('button', { name: /^Annulla/ }).click();
    const afterUndoLand = await page.evaluate(() => {
      const { mask } = window.__MAP_EDITOR_DEBUG__!.getDocument().terrain;
      for (let i = 0; i < mask.length; i += 16) {
        if (mask[i] > 0) return true;
      }
      return false;
    });
    expect(afterUndoLand).toBe(false);
    await page.getByRole('button', { name: /^Ripristina/ }).click();

    // 2. Smart land brush: ragged western island with organic positive relief
    await page.getByRole('button', { name: 'Terra (B)' }).click();
    await expect(page.getByRole('button', { name: 'Intelligente' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByRole('slider', { name: /Frastagliatura costa/ })).toBeVisible();
    await setBrushDiameter(page, 180);
    await dragOnMap(page, 0.24, 0.56, 0.28, 0.58, 6);
    const smartIslandCell = await inspectCellAtNorm(page, 0.26, 0.57);
    expect(smartIslandCell.mask).toBeGreaterThanOrEqual(128);
    expect(smartIslandCell.height).toBeGreaterThan(0);

    // 3. Peaked mountains ("Alza picchi") MUST NOT flatten to 255 plateau, plus dedicated "Altopiano"
    await page.getByRole('button', { name: 'Rilievo (E)' }).click();
    const modesGroup = page.getByRole('group', { name: 'Modalità rilievo' });
    await expect(modesGroup.getByRole('button', { name: 'Alza picchi' })).toBeVisible();
    await expect(modesGroup.getByRole('button', { name: 'Altopiano' })).toBeVisible();

    await modesGroup.getByRole('button', { name: 'Alza picchi' }).click();
    await setBrushDiameter(page, 220);
    const intensityInput = page
      .locator('#editor-properties-panel')
      .getByRole('spinbutton', { name: /Intensità/ });
    await intensityInput.fill('100');
    await intensityInput.press('Enter');

    // Ensure solid land beneath (0.56, 0.44) first, then sculpt 5 peak passes
    await page.getByRole('button', { name: 'Terra (B)' }).click();
    await clickOnMap(page, 0.56, 0.44);
    await page.getByRole('button', { name: 'Rilievo (E)' }).click();
    for (let p = 0; p < 5; p += 1) {
      await dragOnMap(page, 0.53, 0.44, 0.59, 0.44, 6);
    }

    const peakStats = await page.evaluate(() => {
      const doc = window.__MAP_EDITOR_DEBUG__!.getDocument();
      const { widthPx, heightPx, mask, height } = doc.terrain;
      const cx = Math.round(0.56 * widthPx);
      const cy = Math.round(0.44 * heightPx);
      const rx = Math.max(20, Math.round(widthPx * 0.04));
      const ry = Math.max(20, Math.round(heightPx * 0.04));
      const vals: number[] = [];
      let exact255 = 0;
      for (let y = cy - ry; y <= cy + ry; y += 2) {
        for (let x = cx - rx; x <= cx + rx; x += 2) {
          const i = y * widthPx + x;
          if (mask[i] >= 128) {
            vals.push(height[i]);
            if (height[i] === 255) exact255 += 1;
          }
        }
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const stdDev = Math.sqrt(
        vals.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / vals.length
      );
      return {
        maxH: Math.max(...vals),
        stdDev,
        frac255: exact255 / vals.length
      };
    });
    expect(peakStats.maxH).toBeGreaterThan(165);
    expect(peakStats.stdDev).toBeGreaterThan(9);
    expect(peakStats.frac255).toBeLessThan(0.2);

    // Sculpt flat plateau at target 225 on solid land patch (0.40, 0.62)
    await page.getByRole('button', { name: 'Terra (B)' }).click();
    await clickOnMap(page, 0.40, 0.62);
    await page.getByRole('button', { name: 'Rilievo (E)' }).click();
    await modesGroup.getByRole('button', { name: 'Altopiano' }).click();
    await page.getByRole('group', { name: 'Preset quota altopiano' }).getByRole('button', { name: /Tavolato/ }).click();
    await setBrushDiameter(page, 140);
    await dragOnMap(page, 0.39, 0.62, 0.41, 0.62, 5);
    await dragOnMap(page, 0.39, 0.62, 0.41, 0.62, 5);
    const plateauCell = await inspectCellAtNorm(page, 0.40, 0.62);
    expect(plateauCell.height).toBeGreaterThanOrEqual(200);
    expect(plateauCell.height).toBeLessThanOrEqual(235);

    // 4. Smart materials (Foresta, Campi, Palude, Sabbia) on known land
    await page.getByRole('button', { name: 'Superfici (C)' }).click();
    const mats = page.getByRole('group', { name: 'Materiali di copertura' });
    await setBrushDiameter(page, 120);
    await mats.getByRole('button', { name: /^Foresta\b/ }).click();
    await clickOnMap(page, 0.26, 0.57);
    await mats.getByRole('button', { name: /^Palude\b/ }).click();
    await clickOnMap(page, 0.46, 0.68);
    await mats.getByRole('button', { name: /^Campi\b/ }).click();
    await clickOnMap(page, 0.48, 0.50);

    // 5. Vector River + Road
    await page.getByRole('button', { name: 'Fiumi e Strade (R)' }).click();
    await dragOnMap(page, 0.64, 0.36, 0.38, 0.48, 12);
    await page.getByRole('group', { name: 'Stile tracciato' }).getByRole('button', { name: 'Strada' }).click();
    await dragOnMap(page, 0.40, 0.36, 0.54, 0.58, 10);

    // 6. Place Witcher POIs with "Etichetta alla posa" enabled -> ivory (#F5EAD0) on dark sepia halo
    await page.getByRole('button', { name: 'POI (P)' }).click();
    const autoLabelCheckbox = page.getByLabel('Etichetta alla posa');
    await expect(autoLabelCheckbox).toBeVisible();
    await autoLabelCheckbox.check();

    const poiGrid = page.getByRole('group', { name: 'Libreria simboli POI' });
    await poiGrid.getByRole('button', { name: /^Metropoli murata\b/ }).click();
    await clickOnMap(page, 0.42, 0.38);
    const novigradEditor = page.getByLabel('Nuova etichetta sulla carta');
    await expect(novigradEditor).toBeVisible();
    await novigradEditor.fill('Novigrad');
    await novigradEditor.press('Enter');

    await poiGrid.getByRole('button', { name: /^Rocca collinare\b/ }).click();
    await clickOnMap(page, 0.50, 0.56);
    const crowsEditor = page.getByLabel('Nuova etichetta sulla carta');
    await expect(crowsEditor).toBeVisible();
    await crowsEditor.fill('Crow’s Perch');
    await crowsEditor.press('Enter');

    await autoLabelCheckbox.uncheck();
    await poiGrid.getByRole('button', { name: /^Drakkar nordico\b/ }).click();
    await clickOnMap(page, 0.16, 0.34);
    await poiGrid.getByRole('button', { name: /^Rosa con cartiglio\b/ }).click();
    await clickOnMap(page, 0.13, 0.16);
    await poiGrid.getByRole('button', { name: /^Banco di nubi\b/ }).click();
    await clickOnMap(page, 0.84, 0.22);

    const labels = await page.evaluate(() => {
      return window.__MAP_EDITOR_DEBUG__!
        .getDocument()
        .manifest.objects.filter((o) => o.type === 'label')
        .map((l) => ({ text: l.text, color: l.color }));
    });
    expect(labels).toEqual(
      expect.arrayContaining([
        { text: 'Novigrad', color: '#F5EAD0' },
        { text: 'Crow’s Perch', color: '#F5EAD0' }
      ])
    );

    // Deselect before visual capture
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: '/Users/eneaminelli/.gemini/antigravity/brain/7ce58378-5b1e-4108-b61e-d58c8716d10d/scratch/witcher-atlas-preview.png'
    });

    expect(tracker.errors).toEqual([]);
    tracker.dispose();
  });
});
