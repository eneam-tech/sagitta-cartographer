import { expect, test } from '@playwright/test';
import {
  attachErrorTracker,
  clickOnMap,
  createCleanProject,
  dragOnMap,
  inspectCellAtNorm,
  paintIslandCluster,
  setBrushDiameter
} from './helpers';

test.describe('Core 1: Terrain, Elevation Intensity & 10 Surface Materials', () => {
  test('draws landmass, sculpts with all 5 elevation tools & intensity, paints all 10 materials, carves water, and aligns pan/zoom', async ({
    page
  }) => {
    const tracker = attachErrorTracker(page);
    await createCleanProject(page, { title: 'Terra e Rilievi' });

    // 1. Paint solid island and verify mask >= 128 in the center
    await paintIslandCluster(page);
    const centerAfterLand = await inspectCellAtNorm(page, 0.5, 0.5);
    expect(centerAfterLand.mask).toBeGreaterThanOrEqual(128);

    // 2. Verify all 5 Elevation modes and intensity presets
    await page.getByRole('button', { name: 'Rilievo (E)' }).click();
    const modesGroup = page.getByRole('group', { name: 'Modalità rilievo' });
    await expect(modesGroup.getByRole('button', { name: /^Alza/ })).toBeVisible();
    await expect(modesGroup.getByRole('button', { name: 'Altopiano' })).toBeVisible();
    await expect(modesGroup.getByRole('button', { name: 'Abbassa' })).toBeVisible();
    await expect(modesGroup.getByRole('button', { name: 'Appiattisci' })).toBeVisible();
    await expect(modesGroup.getByRole('button', { name: 'Ammorbidisci' })).toBeVisible();

    await page.getByRole('group', { name: 'Preset intensità rilievo' }).getByRole('button', { name: /Forte/ }).click();
    await setBrushDiameter(page, 220);

    // Raise peak strongly on left highland (0.40, 0.48)
    await modesGroup.getByRole('button', { name: /^Alza/ }).click();
    await dragOnMap(page, 0.38, 0.48, 0.42, 0.48, 8);
    await dragOnMap(page, 0.38, 0.48, 0.42, 0.48, 8);
    const raisedCell = await inspectCellAtNorm(page, 0.4, 0.48);
    expect(raisedCell.height).toBeGreaterThan(80);

    // Flatten plateau starting at (0.50, 0.48) toward target (0.40, 0.48 -> higher)
    await modesGroup.getByRole('button', { name: 'Appiattisci' }).click();
    await dragOnMap(page, 0.40, 0.48, 0.44, 0.48, 6);

    // Smooth ridge
    await modesGroup.getByRole('button', { name: 'Ammorbidisci' }).click();
    await dragOnMap(page, 0.38, 0.48, 0.44, 0.48, 6);

    // Lower a valley on (0.40, 0.48) at 80% intensity
    const heightBeforeLower = (await inspectCellAtNorm(page, 0.4, 0.48)).height;
    await modesGroup.getByRole('button', { name: 'Abbassa' }).click();
    await dragOnMap(page, 0.39, 0.48, 0.41, 0.48, 10);
    const heightAfterLower = (await inspectCellAtNorm(page, 0.4, 0.48)).height;
    expect(heightAfterLower).toBeLessThan(heightBeforeLower);

    // 3. Verify all 10 surface materials exist and paint distinct CoverCode values
    await page.getByRole('button', { name: 'Superfici (C)' }).click();
    const materialsGroup = page.getByRole('group', { name: 'Materiali di copertura' });
    const expectedMaterials = [
      'Naturale',
      'Foresta',
      'Campi',
      'Prateria',
      'Sabbia',
      'Roccia',
      'Neve',
      'Palude',
      'Mattoni',
      'Lava'
    ];
    for (const mat of expectedMaterials) {
      await expect(materialsGroup.getByRole('button', { name: new RegExp(`^${mat}\\b`) })).toBeVisible();
    }

    await page.getByRole('slider', { name: /Diametro/ }).fill('140');
    const paints: Array<{ label: RegExp; nx: number; ny: number; code: number }> = [
      { label: /^Foresta\b/, nx: 0.37, ny: 0.40, code: 1 },
      { label: /^Campi\b/, nx: 0.46, ny: 0.40, code: 2 },
      { label: /^Sabbia\b/, nx: 0.55, ny: 0.40, code: 3 },
      { label: /^Mattoni\b/, nx: 0.63, ny: 0.40, code: 4 },
      { label: /^Neve\b/, nx: 0.37, ny: 0.56, code: 5 },
      { label: /^Palude\b/, nx: 0.46, ny: 0.56, code: 6 },
      { label: /^Roccia\b/, nx: 0.55, ny: 0.56, code: 7 },
      { label: /^Prateria\b/, nx: 0.63, ny: 0.56, code: 8 },
      { label: /^Lava\b/, nx: 0.50, ny: 0.48, code: 9 }
    ];

    for (const p of paints) {
      await materialsGroup.getByRole('button', { name: p.label }).click();
      await clickOnMap(page, p.nx, p.ny);
      const cell = await inspectCellAtNorm(page, p.nx, p.ny);
      expect(cell.cover).toBe(p.code);
    }

    // Repaint lava back to Naturale (0) and verify restoration
    await materialsGroup.getByRole('button', { name: /^Naturale\b/ }).click();
    await clickOnMap(page, 0.5, 0.48);
    expect((await inspectCellAtNorm(page, 0.5, 0.48)).cover).toBe(0);

    // 4. Carve sea lake at (0.55, 0.40) and verify mask=0, height=0, cover=0
    await page.getByRole('button', { name: 'Acqua (W)' }).click();
    await clickOnMap(page, 0.55, 0.40);
    const lakeCell = await inspectCellAtNorm(page, 0.55, 0.40);
    expect(lakeCell.mask).toBe(0);
    expect(lakeCell.height).toBe(0);
    expect(lakeCell.cover).toBe(0);

    // Undo restores the carved sand patch
    await page.getByRole('button', { name: /^Annulla/ }).click();
    const restoredSand = await inspectCellAtNorm(page, 0.55, 0.40);
    expect(restoredSand.mask).toBeGreaterThanOrEqual(128);
    expect(restoredSand.cover).toBe(3);

    // 5. Zoom + Pan cursor-to-doc alignment: painting after zoom hits exact doc target
    await page.getByRole('button', { name: 'Aumenta zoom' }).click();
    await page.getByRole('button', { name: 'Aumenta zoom' }).click();
    await page.getByRole('button', { name: 'Mano (H)' }).click();
    await dragOnMap(page, 0.5, 0.5, 0.45, 0.46, 6);

    await page.getByRole('button', { name: 'Superfici (C)' }).click();
    await materialsGroup.getByRole('button', { name: /^Lava\b/ }).click();
    await clickOnMap(page, 0.5, 0.48);
    expect((await inspectCellAtNorm(page, 0.5, 0.48)).cover).toBe(9);

    expect(tracker.errors).toEqual([]);
    tracker.dispose();
  });
});
