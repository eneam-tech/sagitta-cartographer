import { expect, Page } from '@playwright/test';

export interface E2eErrorTracker {
  errors: string[];
  dispose: () => void;
}

export function attachErrorTracker(page: Page): E2eErrorTracker {
  const errors: string[] = [];
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') {
      errors.push(`[console.error] ${msg.text()}`);
    }
  };
  const onPageError = (err: Error) => {
    errors.push(`[pageerror] ${err.message}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return {
    errors,
    dispose: () => {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
  };
}

export async function waitForEditorReady(page: Page): Promise<void> {
  await page.waitForSelector('[aria-label="Area di lavoro della carta"]');
  await page.waitForFunction(() => Boolean(window.__MAP_EDITOR_DEBUG__?.store));
}

export async function createCleanProject(
  page: Page,
  options: {
    title?: string;
    presetLabel?: string;
    themeId?: string;
  } = {}
): Promise<void> {
  await page.goto('/');
  await waitForEditorReady(page);

  await page.getByRole('button', { name: 'Menu progetto' }).click();
  await page.getByRole('menuitem', { name: 'Nuova carta' }).click();

  const dialog = page.getByRole('dialog', { name: 'Nuova carta' });
  await expect(dialog).toBeVisible();

  if (options.title) {
    const titleInput = dialog.getByLabel('Titolo del progetto');
    await titleInput.fill(options.title);
  }
  if (options.presetLabel) {
    await dialog.getByRole('radio', { name: options.presetLabel }).check();
  }
  if (options.themeId) {
    await dialog.getByLabel('Tema cartografico iniziale').selectOption(options.themeId);
  }

  await dialog.getByRole('button', { name: 'Crea carta' }).click();
  await expect(dialog).toBeHidden();

  if (options.title) {
    await expect(page.getByLabel('Titolo della carta')).toHaveValue(options.title);
  }
}

export async function setBrushDiameter(page: Page, diameterDoc: number): Promise<void> {
  const input = page
    .locator('#editor-properties-panel')
    .getByRole('spinbutton', { name: /Diametro/ });
  await input.fill(String(diameterDoc));
  await input.press('Enter');
}

export async function getViewportClientCoords(
  page: Page,
  normX: number,
  normY: number
): Promise<{ x: number; y: number }> {
  const rect = await page.locator('[aria-label="Area di lavoro della carta"]').boundingBox();
  if (!rect) {
    throw new Error('Viewport della carta non trovato.');
  }
  const point = await page.evaluate(
    ({ nx, ny }) => {
      const dbg = window.__MAP_EDITOR_DEBUG__;
      if (!dbg) throw new Error('Debug handle non disponibile.');
      const snap = dbg.store.getSnapshot();
      const docX = nx * snap.doc.manifest.space.width;
      const docY = ny * snap.doc.manifest.space.height;
      return {
        localX: docX * snap.camera.scale + snap.camera.offsetX,
        localY: docY * snap.camera.scale + snap.camera.offsetY
      };
    },
    { nx: normX, ny: normY }
  );
  return {
    x: rect.x + point.localX,
    y: rect.y + point.localY
  };
}

export async function clickOnMap(page: Page, normX: number, normY: number): Promise<void> {
  const pt = await getViewportClientCoords(page, normX, normY);
  await page.mouse.click(pt.x, pt.y);
}

export async function dragOnMap(
  page: Page,
  startNormX: number,
  startNormY: number,
  endNormX: number,
  endNormY: number,
  steps = 12
): Promise<void> {
  const from = await getViewportClientCoords(page, startNormX, startNormY);
  const to = await getViewportClientCoords(page, endNormX, endNormY);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export async function paintIslandCluster(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Terra (B)' }).click();
  await setBrushDiameter(page, 320);
  await dragOnMap(page, 0.34, 0.42, 0.66, 0.42, 8);
  await dragOnMap(page, 0.34, 0.56, 0.66, 0.56, 8);
  await dragOnMap(page, 0.5, 0.34, 0.5, 0.64, 8);
}

export async function inspectCellAtNorm(
  page: Page,
  normX: number,
  normY: number
): Promise<{ mask: number; height: number; cover: number }> {
  return page.evaluate(
    ({ nx, ny }) => {
      const doc = window.__MAP_EDITOR_DEBUG__!.getDocument();
      const { widthPx, heightPx, mask, height, cover } = doc.terrain;
      const px = Math.min(widthPx - 1, Math.max(0, Math.round(nx * widthPx)));
      const py = Math.min(heightPx - 1, Math.max(0, Math.round(ny * heightPx)));
      const idx = py * widthPx + px;
      return { mask: mask[idx], height: height[idx], cover: cover[idx] };
    },
    { nx: normX, ny: normY }
  );
}

export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.locator('.statusbar-left')).toContainText('Salvato', {
    timeout: 10_000
  });
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
}
