import { expect, test } from '@playwright/test';

for (const dispersion of [0, 0.1]) {
  test(`lens graph preserves transparent samples with dispersion ${dispersion}`, async ({ page }) => {
    await page.goto('/regression.html');
    await page.evaluate((dispersion) => {
      const { glassTest } = window as unknown as {
        glassTest: { render(options: Record<string, unknown>): void };
      };
      glassTest.render({ count: 1, optics: { blur: 0, saturation: 100, brightness: 1, dispersion } });
    }, dispersion);
    await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);

    const pixels = await page.evaluate(async () => {
      // Exercise the registry's real graph in an isolated SVG so transparent
      // and half-transparent inputs are deterministic on every compositor.
      const filter = document.querySelector('filter')!.cloneNode(true) as SVGFilterElement;
      for (const [name, value] of Object.entries({
        filterUnits: 'userSpaceOnUse', x: '0', y: '0', width: '160', height: '40',
      })) filter.setAttribute(name, value);
      // Zero displacement isolates channel extraction and the screen blends.
      filter.querySelectorAll('feDisplacementMap').forEach(node => node.setAttribute('scale', '0'));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40">
        <defs>${filter.outerHTML}</defs><g filter="url(#${filter.id})">
          <rect x="40" width="40" height="40" fill="rgb(128,64,192)" opacity="0.5"/>
          <rect x="80" width="40" height="40" fill="rgb(128,64,192)"/>
        </g></svg>`;
      const image = new Image();
      image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 40;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const sample = (x: number) => Array.from(context.getImageData(x, 20, 1, 1).data);
      const transparent = sample(20), partial = sample(60), opaque = sample(100);
      // Also check the seam over a visible backdrop, including outside the
      // source bounds where the old matrices painted opaque black.
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = 'rgb(160,216,239)';
      context.fillRect(0, 0, 160, 40);
      return { transparent, partial, opaque, backdrop: sample(20), partialOverBackdrop: sample(60) };
    });

    const near = (actual: number[], expected: number[]) => {
      actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(2));
    };
    expect(pixels.transparent).toEqual([0, 0, 0, 0]);
    near(pixels.opaque, [128, 64, 192, 255]);
    expect(pixels.backdrop).toEqual([160, 216, 239, 255]);
    if (dispersion === 0) {
      near(pixels.partial, [128, 64, 192, 128]);
      near(pixels.partialOverBackdrop, [144, 140, 216, 255]);
    } else {
      // Screen uses source-over alpha: three half-transparent channels yield
      // 1 - (1 - 0.5)^3 = 0.875, while opaque RGB remains unchanged.
      near(pixels.partial, [73, 37, 110, 223]);
      near(pixels.partialOverBackdrop, [84, 59, 126, 255]);
    }
  });
}

for (const elasticity of [0, 0.2]) {
  test(`rapid width reversals settle on a valid transparent lens with elasticity ${elasticity}`, async ({ page }) => {
    await page.goto('/regression.html');
    await page.evaluate((elasticity) => window.glassTest.render({
      count: 1, width: 306, radius: 26, elasticity,
      optics: { blur: 3, saturation: 100, brightness: 1.1, depth: 8, curvature: 0.2, dispersion: 0.1 },
    }), elasticity);
    const surface = page.locator('[data-test="surface-0"]');
    await expect(surface.locator('.ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
    await surface.evaluate(element => {
      (element as HTMLElement).style.transition = 'width 300ms ease';
    });
    const initial = (await surface.boundingBox())!;
    for (let i = 0; i < 12; i++) {
      await surface.evaluate((element, width) => { (element as HTMLElement).style.width = `${width}px`; }, i % 2 ? 306 : 422);
      await page.mouse.move(initial.x + (i % 2 ? 3 : initial.width - 3), initial.y + 25, { steps: 5 });
    }
    // Finish at a new size so this verifies replacement, rather than reusing
    // the initial map after a trailing resize debounce.
    await surface.evaluate(element => { (element as HTMLElement).style.width = '380px'; });
    await expect(page.locator('filter')).toHaveCount(1);
    await expect(page.locator('filter feImage')).toHaveAttribute('width', '380');
    await expect(page.locator('filter feColorMatrix[in^="ngs_disp_"]')).toHaveCount(3);
    const rows = await page.locator('filter feColorMatrix[in^="ngs_disp_"]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('values')!.trim().split(/\s+/).map(Number).slice(15)),
    );
    expect(rows).toEqual(Array.from({ length: 3 }, () => [0, 0, 0, 1, 0]));
    const referenced = await surface.locator('.ngs-effect').evaluate(element => {
      const id = getComputedStyle(element).backdropFilter.match(/#([^\)"']+)/)?.[1];
      return !!id && !!document.getElementById(id);
    });
    expect(referenced).toBe(true);
    await page.evaluate(() => window.glassTest.unmount());
    await expect(page.locator('filter')).toHaveCount(0);
  });
}
