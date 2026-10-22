import { expect, test, ready } from './fixtures';

for (const dispersion of [0, 0.1]) {
  test(`lens graph preserves transparent samples with dispersion ${dispersion}`, async ({ page }) => {
    await ready(page, {
      count: 1, optics: { blur: 0, saturation: 100, brightness: 1, dispersion },
    });

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
