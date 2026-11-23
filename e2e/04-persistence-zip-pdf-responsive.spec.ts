import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  attachErrorTracker,
  clickOnMap,
  createCleanProject,
  dragOnMap,
  paintIslandCluster,
  waitForSaved
} from './helpers';

test.describe('Core 4: Reload Persistence, ZIP Portable Archive, A3 PDF Export & Responsive UI', () => {
  test('persists across reload, exports/imports .zip (and safely rejects corrupted archive), exports A3 PDF honoring hidden layers, opens shortcuts, and stays overflow-free across desktop/tablet/mobile', async ({
    page
  }, testInfo) => {
    test.setTimeout(120_000);
    const tracker = attachErrorTracker(page);
    await createCleanProject(page, {
      title: 'Portolano E2E',
      presetLabel: 'A3 orizzontale (420 × 297 mm)'
    });
    await paintIslandCluster(page);

    // Add a river, POI, label, and a hidden custom layer with an extra stamp
    await page.getByRole('button', { name: 'Fiumi e Strade (R)' }).click();
    await dragOnMap(page, 0.38, 0.45, 0.56, 0.54, 8);

    await page.getByRole('button', { name: 'POI (P)' }).click();
    await clickOnMap(page, 0.50, 0.48);

    await page.getByRole('button', { name: 'Testo (T)' }).click();
    await clickOnMap(page, 0.44, 0.58);
    const labelEditor = page.getByLabel('Nuova etichetta sulla carta');
    await labelEditor.fill('Porto Vecchio');
    await labelEditor.press('Enter');

    await page.getByRole('tab', { name: /^Livelli \(4\)/ }).click();
    await page.getByRole('button', { name: '+ Nuovo livello' }).click();
    await page.getByRole('button', { name: 'POI (P)' }).click();
    await clickOnMap(page, 0.62, 0.44);
    await page.getByRole('tab', { name: /^Livelli \(5\)/ }).click();
    await page.getByRole('button', { name: 'Nascondi livello Livello 1' }).click();

    await waitForSaved(page);

    // 1. Reload browser and confirm IndexedDB hydration restores everything identically
    await page.reload();
    await page.waitForSelector('[aria-label="Area di lavoro della carta"]');
    await page.waitForFunction(() => Boolean(window.__MAP_EDITOR_DEBUG__?.store));

    await expect(page.getByLabel('Titolo della carta')).toHaveValue('Portolano E2E', {
      timeout: 25_000
    });
    await expect(page.locator('.topbar-canvas-label')).toContainText('420×297 mm');
    await expect(page.getByRole('tab', { name: /^Livelli \(5\)/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Oggetti \(4\)/ })).toBeVisible();

    // 2. Export portable .zip archive, verify PK magic bytes, test corrupted import isolation, then re-import clean archive
    await page.getByRole('button', { name: 'Menu progetto' }).click();
    const [zipDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('menuitem', { name: 'Scarica progetto (.zip)' }).click()
    ]);
    const zipPath = testInfo.outputPath(zipDownload.suggestedFilename());
    await zipDownload.saveAs(zipPath);
    const zipBytes = await readFile(zipPath);
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'
    expect(zipBytes.byteLength).toBeGreaterThan(2000);

    // Create a fresh blank project, verify corrupted import fails gracefully without losing current project
    await createCleanProject(page, { title: 'Carta Temporanea' });
    const badZipPath = testInfo.outputPath('corrupt.zip');
    await import('node:fs/promises').then((fs) => fs.writeFile(badZipPath, Buffer.from('not-a-valid-zip')));
    await page.getByRole('button', { name: 'Menu progetto' }).click();
    const [badChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('menuitem', { name: 'Importa archivio (.zip)…' }).click()
    ]);
    await badChooser.setFiles(badZipPath);
    await expect(page.getByLabel('Titolo della carta')).toHaveValue('Carta Temporanea');
    await expect(page.locator('.statusbar-left')).toContainText(/errore|valido|Archivio/i);

    // Import the real .zip archive and verify full restoration
    await page.getByRole('button', { name: 'Menu progetto' }).click();
    const [goodChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('menuitem', { name: 'Importa archivio (.zip)…' }).click()
    ]);
    await goodChooser.setFiles(zipPath);
    await expect(page.getByLabel('Titolo della carta')).toHaveValue('Portolano E2E', {
      timeout: 30_000
    });
    await expect(page.locator('.topbar-canvas-label')).toContainText('420×297 mm');
    await expect(page.getByRole('tab', { name: /^Oggetti \(4\)/ })).toBeVisible();

    // 3. Export A3 PDF from a zoomed-in view -> validate dimensions via pdf-lib & hidden layer warning
    await page.getByRole('button', { name: 'Aumenta zoom' }).click();
    await page.getByRole('button', { name: 'Aumenta zoom' }).click();
    await page.getByRole('button', { name: 'Esporta PDF' }).click();

    const pdfDialog = page.getByRole('dialog', { name: 'Esporta PDF' });
    await expect(pdfDialog).toBeVisible();
    await expect(pdfDialog).toContainText('1 livello nascosto escluso dalla stampa: «Livello 1»');
    await pdfDialog.getByLabel('Risoluzione di stampa').selectOption('150');

    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      pdfDialog.getByRole('button', { name: 'Esporta PDF' }).click()
    ]);
    const pdfPath = testInfo.outputPath(pdfDownload.suggestedFilename());
    await pdfDownload.saveAs(pdfPath);
    const pdfBytes = await readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    expect(pdfDoc.getPageCount()).toBe(1);
    const size = pdfDoc.getPage(0).getSize();
    expect(size.width).toBeCloseTo(1190.55, 1); // 420 mm
    expect(size.height).toBeCloseTo(841.89, 1); // 297 mm
    await expect(pdfDialog).toBeHidden();

    // 4. Shortcuts modal (?) opens & Esc closes cleanly
    await page.getByRole('button', { name: 'Scorciatoie da tastiera (?)' }).click();
    const shortcutsDialog = page.getByRole('dialog', { name: 'Scorciatoie da tastiera' });
    await expect(shortcutsDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(shortcutsDialog).toBeHidden();

    // 5. Responsive layout checks (1440x900, 1280x800, 1024x768, 390x844)
    for (const vp of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 }
    ]) {
      await page.setViewportSize(vp);
      await assertNoHorizontalOverflow(page);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Apri o chiudi pannello proprietà' }).click();
    await expect(page.locator('#editor-properties-panel')).toBeVisible();
    await assertNoHorizontalOverflow(page);

    expect(tracker.errors).toEqual([]);
    tracker.dispose();
  });
});
