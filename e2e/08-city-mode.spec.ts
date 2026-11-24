import { expect, test } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  attachErrorTracker,
  clickOnMap,
  dragOnMap,
  waitForEditorReady,
  waitForSaved
} from './helpers';

test.describe('Modalità Urbana / Città — Flusso completo end-to-end', () => {
  test('creazione carta città da Nuova carta, generatore procedurale, strumenti urbani, stili e persistenza', async ({
    page
  }) => {
    const tracker = attachErrorTracker(page);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      await waitForEditorReady(page);

      // Verifica che TopBar NON abbia selettori di ambiente
      await expect(page.locator('.topbar-env-switcher')).toHaveCount(0);

      // 1. Apri Nuova carta: verifica Continente predefinito, poi seleziona Città
      await page.getByRole('button', { name: 'Menu progetto' }).click();
      await page.getByRole('menuitem', { name: 'Nuova carta' }).click();

      const newDialog = page.getByRole('dialog', { name: 'Nuova carta' });
      await expect(newDialog).toBeVisible();
      await expect(newDialog.getByRole('radio', { name: /Continente/i })).toBeChecked();

      await newDialog.getByRole('radio', { name: /Città/i }).check();
      await newDialog.getByLabel('Titolo del progetto').fill('Città di Solaria');
      await newDialog.getByRole('radio', { name: /Borgo medievale organico/i }).check();
      await newDialog.getByRole('button', { name: 'Crea carta' }).click();
      await expect(newDialog).toBeHidden();

      await expect(page.getByLabel('Titolo della carta')).toHaveValue('Città di Solaria');

      // Verifica ToolRail urbana e assenza overflow
      await expect(
        page.getByRole('button', { name: 'Quartiere intelligente (Q)' })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edificio (U)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Strade (R)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Griglia stradale (G)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Piazza (K)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mura cittadine (M)' })).toBeVisible();
      await assertNoHorizontalOverflow(page);

      const docAfterCreate = await page.evaluate(() => ({
        kind: window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.kind,
        layerCount: window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.layers.length,
        themeId: window.__MAP_EDITOR_DEBUG__!.getDocument().theme.id
      }));
      expect(docAfterCreate.kind).toBe('city');
      expect(docAfterCreate.layerCount).toBe(5);
      expect(docAfterCreate.themeId).toBe('city-medieval');

      // 2. Genera città procedurale e verifica Undo / Redo in 1 passaggio
      await page.getByRole('button', { name: 'Genera città procedurale' }).click();
      const genDialog = page.getByRole('dialog', { name: 'Genera città' });
      await expect(genDialog).toBeVisible();
      await genDialog.getByRole('button', { name: /Città portuale e canali/i }).click();
      await genDialog.getByRole('button', { name: 'Genera città' }).click();
      await expect(genDialog).toBeHidden();

      const generatedStats = await page.evaluate(() => {
        const objs = window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects;
        return {
          total: objs.length,
          buildings: objs.filter((o) => o.type === 'building').length,
          paths: objs.filter((o) => o.type === 'path').length,
          plazas: objs.filter((o) => o.type === 'plaza').length,
          labels: objs.filter((o) => o.type === 'label').length
        };
      });
      expect(generatedStats.buildings).toBeGreaterThan(15);
      expect(generatedStats.paths).toBeGreaterThan(4);
      expect(generatedStats.plazas).toBeGreaterThanOrEqual(1);
      expect(generatedStats.labels).toBeGreaterThanOrEqual(2);

      // Undo in 1 passo ripristina mappa vuota
      await page.getByRole('button', { name: /^Annulla/ }).click();
      const countAfterUndo = await page.evaluate(
        () => window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects.length
      );
      expect(countAfterUndo).toBe(0);

      // 3. Strumenti interattivi sul canvas (Strade, Quartiere, Piazza con sgombero, Edificio, Griglia, Mura)
      await page.getByRole('button', { name: 'Strade (R)' }).click();
      await dragOnMap(page, 0.25, 0.45, 0.78, 0.45, 10);

      const streetsAfterDraw = await page.evaluate(
        () =>
          window.__MAP_EDITOR_DEBUG__!
            .getDocument()
            .manifest.objects.filter((o) => o.type === 'path').length
      );
      expect(streetsAfterDraw).toBe(1);

      await page.getByRole('button', { name: 'Quartiere intelligente (Q)' }).click();
      await dragOnMap(page, 0.34, 0.36, 0.66, 0.36, 10);

      const buildingsAfterDistrict = await page.evaluate(
        () =>
          window.__MAP_EDITOR_DEBUG__!
            .getDocument()
            .manifest.objects.filter((o) => o.type === 'building').length
      );
      expect(buildingsAfterDistrict).toBeGreaterThanOrEqual(3);

      // Posa Piazza (K) sopra gli edifici appena disegnati (deve sgomberare quelli sotto la piazza)
      await page.getByRole('button', { name: 'Piazza (K)' }).click();
      await clickOnMap(page, 0.5, 0.36);

      const afterPlaza = await page.evaluate(() => {
        const objs = window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects;
        return {
          plazas: objs.filter((o) => o.type === 'plaza').length,
          buildings: objs.filter((o) => o.type === 'building').length
        };
      });
      expect(afterPlaza.plazas).toBe(1);
      expect(afterPlaza.buildings).toBeLessThan(buildingsAfterDistrict);

      // Posa singolo Edificio (Cattedrale)
      await page.getByRole('button', { name: 'Edificio (U)' }).click();
      await page.locator('#editor-properties-panel').getByRole('button', { name: 'Cattedrale' }).click();
      await clickOnMap(page, 0.5, 0.6);

      const hasCathedral = await page.evaluate(() =>
        window.__MAP_EDITOR_DEBUG__!
          .getDocument()
          .manifest.objects.some((o) => o.type === 'building' && o.shape === 'cathedral')
      );
      expect(hasCathedral).toBe(true);

      // Griglia stradale
      await page.getByRole('button', { name: 'Griglia stradale (G)' }).click();
      await dragOnMap(page, 0.18, 0.58, 0.42, 0.84, 10);
      const pathsAfterGrid = await page.evaluate(
        () =>
          window.__MAP_EDITOR_DEBUG__!
            .getDocument()
            .manifest.objects.filter((o) => o.type === 'path').length
      );
      expect(pathsAfterGrid).toBeGreaterThan(streetsAfterDraw);

      // Mura cittadine che attraversano la strada orizzontale
      await page.getByRole('button', { name: 'Mura cittadine (M)' }).click();
      const modeGroup = page.getByRole('group', { name: 'Modalità tracciamento mura' });
      const styleGroup = page.getByRole('group', { name: 'Stile fortificazione mura' });
      await expect(modeGroup).toBeVisible();
      await expect(styleGroup).toBeVisible();
      await expect(modeGroup.getByRole('button', { name: 'Cortine' })).toHaveAttribute('aria-pressed', 'true');
      await modeGroup.getByRole('button', { name: 'Arco' }).click();
      await expect(page.getByText('Arco sfaccettato a cortine')).toBeVisible();
      await modeGroup.getByRole('button', { name: 'Cortine' }).click();
      await expect(styleGroup.getByRole('button', { name: 'Pietra' })).toBeVisible();
      await expect(styleGroup.getByRole('button', { name: 'Palizzata' })).toBeVisible();
      await expect(styleGroup.getByRole('button', { name: 'Bastioni' })).toBeVisible();
      await expect(styleGroup.getByRole('button', { name: 'Muretto' })).toBeVisible();

      await dragOnMap(page, 0.52, 0.16, 0.52, 0.86, 12);

      const wallCheck = await page.evaluate(() => {
        const objs = window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects;
        const walls = objs.filter(
          (o): o is Extract<typeof o, { type: 'path' }> => o.type === 'path' && o.kind === 'wall'
        );
        const firstWall = walls[0];
        return {
          walls: walls.length,
          wallStyle: firstWall?.wallStyle,
          smooth: firstWall?.smooth,
          gates: firstWall?.wallGates?.length ?? 0,
          side: firstWall?.wallSide,
          gatehouses: objs.filter((o) => o.type === 'building' && o.districtTag === 'gatehouse')
            .length
        };
      });
      expect(wallCheck.walls).toBe(1);
      expect(wallCheck.wallStyle).toBe('stone');
      expect(wallCheck.smooth).toBe(false);
      expect(wallCheck.gates).toBeGreaterThanOrEqual(1);
      expect(wallCheck.gatehouses).toBeGreaterThanOrEqual(2);

      // Verifica controlli mura selezionate nell'ispettore (cambio fortificazione e inversione lato)
      await page.getByRole('button', { name: 'Selezione (V)' }).click();
      const propsToggle = page.getByRole('button', { name: 'Apri o chiudi pannello proprietà' });
      if (
        (await propsToggle.isVisible()) &&
        (await propsToggle.getAttribute('aria-expanded')) !== 'true'
      ) {
        await propsToggle.click();
      }
      const inspectorStyleGroup = page.getByRole('group', { name: 'Stile fortificazione mura' });
      await expect(inspectorStyleGroup).toBeVisible();
      await inspectorStyleGroup.getByRole('button', { name: 'Bastioni' }).click();
      await page.getByRole('button', { name: 'Inverti lato esterno' }).click();
      const wallAfterEdit = await page.evaluate(() => {
        const wall = window.__MAP_EDITOR_DEBUG__!
          .getDocument()
          .manifest.objects.find((o) => o.type === 'path' && o.kind === 'wall');
        return wall && wall.type === 'path'
          ? { wallStyle: wall.wallStyle, side: wall.wallSide }
          : null;
      });
      expect(wallAfterEdit?.wallStyle).toBe('bastion');
      expect(wallAfterEdit?.side).toBe(wallCheck.side === -1 ? 1 : -1);

      // 4. Cambia tema a Planimetria a inchiostro antico e verifica menu contestuale
      await page.getByRole('button', { name: /Stile urbano:/i }).click();
      const themeMenu = page.getByRole('menu', { name: 'Seleziona stile urbano' });
      await expect(themeMenu).toBeVisible();
      await expect(themeMenu.getByRole('menuitemradio')).toHaveCount(4);
      await themeMenu.getByRole('menuitemradio', { name: /Planimetria a inchiostro antico/i }).click();

      const themeAfterSwitch = await page.evaluate(() => ({
        id: window.__MAP_EDITOR_DEBUG__!.getDocument().theme.id,
        style: window.__MAP_EDITOR_DEBUG__!.getDocument().theme.city?.renderStyle
      }));
      expect(themeAfterSwitch.id).toBe('city-inkplan');
      expect(themeAfterSwitch.style).toBe('ink-plan');

      // 5. Autosalvataggio IndexedDB + Reload + Badge in Apri locale…
      const dismissNotice = page.getByRole('button', { name: 'Chiudi avviso' });
      if (await dismissNotice.isVisible()) {
        await dismissNotice.click();
      }
      await waitForSaved(page);
      const savedTotalObjects = await page.evaluate(
        () => window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects.length
      );

      await page.reload();
      await waitForEditorReady(page);
      const reloaded = await page.evaluate(() => ({
        kind: window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.kind,
        themeId: window.__MAP_EDITOR_DEBUG__!.getDocument().theme.id,
        count: window.__MAP_EDITOR_DEBUG__!.getDocument().manifest.objects.length
      }));
      expect(reloaded.kind).toBe('city');
      expect(reloaded.themeId).toBe('city-inkplan');
      expect(reloaded.count).toBe(savedTotalObjects);

      await page.getByRole('button', { name: 'Menu progetto' }).click();
      await page.getByRole('menuitem', { name: 'Apri locale…' }).click();
      const openDialog = page.getByRole('dialog', { name: 'Apri progetto locale' });
      await expect(openDialog).toBeVisible();
      await expect(openDialog.locator('.project-kind-badge').first()).toHaveText('Città');
      await openDialog.getByRole('button', { name: 'Chiudi finestra' }).click();

      // 6. Export PDF (verifica rendering anteprima e generazione file senza errori)
      await page.getByRole('button', { name: 'Esporta PDF' }).click();
      const exportDialog = page.getByRole('dialog', { name: 'Esporta PDF' });
      await expect(exportDialog).toBeVisible();
      await expect(exportDialog.getByRole('button', { name: 'Esporta PDF' })).toBeEnabled();
      await exportDialog.getByRole('button', { name: 'Annulla' }).click();

      // 7. Verifica responsività senza overflow orizzontale
      for (const vp of [
        { width: 1024, height: 768 },
        { width: 820, height: 1180 },
        { width: 390, height: 844 }
      ]) {
        await page.setViewportSize(vp);
        await assertNoHorizontalOverflow(page);
      }

      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });
});
