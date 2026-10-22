import { test as base, expect, type Page } from '@playwright/test';
import type { GlassTestApi, Options } from '../regression';

declare global {
  interface Window {
    glassTest: GlassTestApi;
    __activeResizeObservers: number;
    __imageCreates: number;
    __maxImageDecodes: number;
  }
}

// Shared setup also verifies final-owner cleanup after pixel and resize cases.
// Isolated compatibility contexts manage their own pages.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const Native = window.ResizeObserver;
      window.__activeResizeObservers = 0;
      window.ResizeObserver = class extends Native {
        active = false;
        observe(target: Element, options?: ResizeObserverOptions) {
          if (!this.active) { this.active = true; window.__activeResizeObservers++; }
          super.observe(target, options);
        }
        disconnect() {
          if (this.active) { this.active = false; window.__activeResizeObservers--; }
          super.disconnect();
        }
      };
    });
    await page.goto('/regression.html');
    await page.waitForFunction(() => !!window.glassTest);
    await use(page);
    await page.evaluate(() => window.glassTest.unmount());
    await expect(page.locator('filter')).toHaveCount(0);
    expect(await page.evaluate(() => window.__activeResizeObservers)).toBe(0);
    expect(errors).toEqual([]);
  },
});

export { expect };

export async function ready(page: Page, options?: Options) {
  if (options) await page.evaluate(options => window.glassTest.render(options), options);
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
}
