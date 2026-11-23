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

test.describe('Core 2: 31 POI Library (Search/Scatter), Vector Paths, Labels & Spec §11 Interactions', () => {
  test('searches 31 POIs, places single & scatter with 1-step undo, draws tapered/dashed paths, places accented label, and preserves POI over water carve', async ({
    page
  }) => {
    const tracker = attachErrorTracker(page);
    await createCleanProject(page, { title: 'Regno di Pietra' });
    await paintIslandCluster(page);

    // 1. Open POI tool and verify 31-item catalog + search + category filtering
    await page.getByRole('button', { name: 'POI (P)' }).click();
    await expect(page.getByText('31 di 31')).toBeVisible();

    const searchInput = page.getByPlaceholder('Nome, tag o descrizione…');
    await searchInput.fill('vulcano');
    await expect(page.getByText('1 di 31')).toBeVisible();
    await page.getByRole('button', { name: 'Svuota ricerca' }).click();
    await expect(page.getByText('31 di 31')).toBeVisible();

    // Verify categories filter cleanly
    await page.getByRole('group', { name: 'Filtra per categoria POI' }).getByRole('button', { name: 'Fortezze' }).click();
    await expect(page.getByText('5 di 31')).toBeVisible();
    await page.getByRole('group', { name: 'Filtra per categoria POI' }).getByRole('button', { name: 'Tutte' }).click();

    // Place single Torre at (0.48, 0.46)
    await page.getByRole('group', { name: 'Libreria simboli POI' }).getByRole('button', { name: /^Torre\b/ }).click();
    await clickOnMap(page, 0.48, 0.46);
    await expect(page.getByRole('tab', { name: /^Oggetti \(1\)/ })).toBeVisible();

    const towerSnapshotBefore = await page.evaluate(() => {
      const objs = window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects;
      return objs[0];
    });
    expect(towerSnapshotBefore.type).toBe('stamp');

    // Scatter burst of Albero sacro (4 items in 1 undoable batch)
    await page.getByRole('group', { name: 'Modalità pennello POI' }).getByRole('button', { name: 'Scatter' }).click();
    await page.getByRole('group', { name: 'Libreria simboli POI' }).getByRole('button', { name: /^Albero sacro\b/ }).click();
    await clickOnMap(page, 0.58, 0.48);
    await expect(page.getByRole('tab', { name: /^Oggetti \(5\)/ })).toBeVisible();

    // 1-step undo removes entire scatter burst cleanly
    await page.getByRole('button', { name: /^Annulla/ }).click();
    await expect(page.getByRole('tab', { name: /^Oggetti \(1\)/ })).toBeVisible();

    // Redo restores it
    await page.getByRole('button', { name: /^Ripristina/ }).click();
    await expect(page.getByRole('tab', { name: /^Oggetti \(5\)/ })).toBeVisible();

    // 2. Vector paths: Fiume (tapered, Tratteggiato disabled) & Confine (dashed)
    await page.getByRole('button', { name: 'Fiumi e Strade (R)' }).click();
    await expect(page.locator('.statusbar-layer-chip')).toContainText('Livello: Fiumi e Strade');

    const dashedCheckbox = page.getByLabel('Tratteggiato');
    await expect(dashedCheckbox).toBeDisabled(); // tapered river disables dashed cleanly

    await dragOnMap(page, 0.36, 0.42, 0.52, 0.58, 12);
    await expect(page.getByRole('tab', { name: /^Oggetti \(6\)/ })).toBeVisible();

    await page.getByRole('group', { name: 'Stile tracciato' }).getByRole('button', { name: 'Confine' }).click();
    await expect(dashedCheckbox).toBeEnabled();
    await expect(dashedCheckbox).toBeChecked();
    await dragOnMap(page, 0.38, 0.58, 0.62, 0.42, 12);
    await expect(page.getByRole('tab', { name: /^Oggetti \(7\)/ })).toBeVisible();

    // Select river in Oggetti and set Opacità = 50%
    await page.getByRole('tab', { name: /^Oggetti/ }).click();
    await page.getByRole('button', { name: /^Fiume \(Tracciato, livello Fiumi e Strade\)/ }).first().click();
    const opacitySlider = page.getByRole('slider', { name: /Opacità \(%\)/ });
    await opacitySlider.fill('50');
    await opacitySlider.dispatchEvent('change');

    const riverOpacity = await page.evaluate(() => {
      const river = window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects.find(
        (o) => o.type === 'path' && o.kind === 'river'
      );
      return river && river.type === 'path' ? river.opacity : undefined;
    });
    expect(riverOpacity).toBe(0.5);

    // 3. Accented Italian Label ("Baia d’Ossidiana")
    await page.getByRole('button', { name: 'Testo (T)' }).click();
    await clickOnMap(page, 0.44, 0.62);
    const inlineEditor = page.getByLabel('Nuova etichetta sulla carta');
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill('Baia d’Ossidiana');
    await inlineEditor.press('Enter');
    await expect(page.getByRole('tab', { name: /^Oggetti \(8\)/ })).toBeVisible();

    // 4. Spec §11 POI interaction: carving a lake directly under Torre preserves Torre id & coords, and Undo restores terrain
    await page.getByRole('button', { name: 'Acqua (W)' }).click();
    await page.getByRole('tab', { name: 'Strumento' }).click();
    await setBrushDiameter(page, 180);
    await clickOnMap(page, 0.48, 0.46);
    expect((await inspectCellAtNorm(page, 0.48, 0.46)).mask).toBe(0);

    const towerAfterCarve = await page.evaluate((id) => {
      return window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects.find((o) => o.id === id);
    }, towerSnapshotBefore.id);
    expect(towerAfterCarve).toBeDefined();
    expect(towerAfterCarve!.x).toBe(towerSnapshotBefore.x);
    expect(towerAfterCarve!.y).toBe(towerSnapshotBefore.y);

    // Undo restores land beneath Torre while keeping Torre intact
    await page.getByRole('button', { name: /^Annulla/ }).click();
    expect((await inspectCellAtNorm(page, 0.48, 0.46)).mask).toBeGreaterThanOrEqual(128);

    expect(tracker.errors).toEqual([]);
    tracker.dispose();
  });
});
