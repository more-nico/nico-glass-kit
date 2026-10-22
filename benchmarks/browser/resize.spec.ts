import { expect, ready, test } from './fixtures';

for (const mode of [
  { name: 'shared Medium', quality: 'medium', elasticity: 0, private: false },
  { name: 'shared High', quality: 'high', elasticity: 0, private: false },
  { name: 'animated private High', quality: 'high', elasticity: 0.2, private: true },
] as const) {
  test(`continuous resizing stays synchronized with ${mode.name} filters`, async ({ page }) => {
    await ready(page, {
      count: 2, width: 306, radius: 26, quality: mode.quality, elasticity: mode.elasticity,
      boost: mode.private ? 0.5 : 0,
      optics: { blur: 3, brightness: 1.1, depth: 8, curvature: 0.2, dispersion: 0.1 },
    });
    const surface = page.locator('[data-test="surface-0"]');
    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 25);

    const result = await surface.evaluate(async element => {
      const surface = element as HTMLElement;
      const ids = new Set<string>();
      let samples = 0, maxError = 0, dangling = 0, maxFilters = 0;
      // rAF precedes layout/ResizeObserver and would sample the previous frame's
      // map against the next width. Observe after resize commits, before paint.
      const observer = new ResizeObserver(() => queueMicrotask(() => {
        const id = getComputedStyle(surface.querySelector('.ngs-effect')!).backdropFilter.match(/#([^\)"']+)/)?.[1];
        const filter = id && document.getElementById(id);
        const map = filter && filter.querySelector('feImage');
        samples++;
        if (!id || !map) { dangling++; return; }
        ids.add(id);
        maxError = Math.max(maxError,
          Math.abs(surface.offsetWidth - Number(map.getAttribute('width'))),
          Math.abs(surface.offsetHeight - Number(map.getAttribute('height'))));
        maxFilters = Math.max(maxFilters, document.querySelectorAll('filter').length);
      }));
      const frames = async (count: number) => {
        for (let frame = 0; frame < count; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        }
      };
      observer.observe(surface);
      surface.style.transition = 'width 300ms ease, height 300ms ease';
      try {
        for (let i = 0; i < 8; i++) {
          surface.style.width = `${i % 2 ? 306 : 422}px`;
          surface.style.height = `${i % 2 ? 100 : 72}px`;
          await frames(5);
        }
        surface.style.width = '380px';
        surface.style.height = '100px';
        await frames(24);
        return { samples, maxError, dangling, maxFilters, ids: [...ids] };
      } finally {
        observer.disconnect();
      }
    });

    expect(result.samples).toBeGreaterThan(10);
    expect(result.maxError).toBe(0);
    expect(result.dangling).toBe(0);
    expect(result.maxFilters).toBeLessThanOrEqual(2);
    if (mode.private) {
      expect(result.ids).toHaveLength(1);
      await expect(page.locator(`#${result.ids[0]} feFuncR`)).toHaveAttribute('slope', '1.6');
    }
    await expect(page.locator('filter')).toHaveCount(2);
    const otherWidth = await page.locator('[data-test="surface-1"] .ngs-effect').evaluate(element => {
      const id = getComputedStyle(element).backdropFilter.match(/#([^\)"']+)/)![1];
      return Number(document.getElementById(id)!.querySelector('feImage')!.getAttribute('width'));
    });
    expect(otherWidth).toBe(306);

    // Returning to the shared geometry must merge ownership again, without
    // changing the other surface or retaining intermediate animation graphs.
    await surface.evaluate(element => {
      const surface = element as HTMLElement;
      surface.style.transition = 'none';
      surface.style.width = '306px';
    });
    await expect(page.locator('filter')).toHaveCount(mode.private ? 2 : 1);
  });
}
