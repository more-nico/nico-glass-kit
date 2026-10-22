import { test, expect } from './fixtures';

test('rounded optics discard delayed tasks, refresh batch atlases and keep resizing synchronous', async ({ page }) => {
  await page.mouse.move(1300, 800);
  await page.evaluate(() => {
    const state = window as Window & { __lensJobs?: number[] };
    state.__lensJobs = [];
    const Native = window.Worker;
    window.Worker = new Proxy(Native, {
      construct(Target, args) {
        const worker = Reflect.construct(Target, args) as Worker;
        const send = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer) => {
          if (message.input?.kind === 'lens') {
            state.__lensJobs!.push(message.input.maps[0].options.curvature);
            setTimeout(() => Reflect.apply(send, worker, [message, transfer ?? []]), 250);
          } else Reflect.apply(send, worker, [message, transfer ?? []]);
        };
        return worker;
      },
    });
    window.glassTest.render({ renderGroup: true, elasticity: 0.2 });
  });
  const group = page.locator('.ngs-render-group');
  await expect(group).toHaveAttribute('data-ngs-render-members', '3');
  const id = await page.locator('[data-test="surface-0"] .ngs-effect').getAttribute('data-ngs-individual-filter');
  const image = page.locator(`[id="${id}"] feImage`);
  const atlas = group.locator('.ngs-render-defs filter feImage');
  const initialMap = await image.getAttribute('href');
  const initialAtlas = await atlas.getAttribute('href');
  await page.evaluate(() => {
    for (const curvature of [0.11, 0.22, 0.93]) {
      window.glassTest.render({ renderGroup: true, elasticity: 0.2, optics: { curvature } });
    }
  });
  await expect(image).toHaveAttribute('href', initialMap!);
  await expect.poll(() => page.evaluate(() => (window as Window & { __lensJobs: number[] }).__lensJobs.includes(0.93))).toBe(true);
  await expect(image).not.toHaveAttribute('href', initialMap!);
  await expect(atlas).not.toHaveAttribute('href', initialAtlas!);
  await expect(group).toHaveAttribute('data-ngs-render-members', '3');
  const exactMap = await image.getAttribute('href');
  await page.evaluate(() => {
    window.glassTest.unmount();
    window.glassTest.render({ renderGroup: true, elasticity: 0.2, optics: { curvature: 0.93 } });
  });
  const freshEffect = page.locator('[data-test="surface-0"] .ngs-effect');
  await expect(freshEffect).toHaveAttribute('data-ngs-individual-filter', /.+/);
  const freshId = await freshEffect.getAttribute('data-ngs-individual-filter');
  const freshImage = page.locator(`[id="${freshId}"] feImage`);
  await expect(freshImage).toHaveAttribute('href', exactMap!);
  await page.evaluate(() => {
    window.glassTest.render({ renderGroup: true, elasticity: 0.2, optics: { curvature: 0.47 } });
    window.glassTest.render({ renderGroup: true, elasticity: 0.2, width: 280, optics: { curvature: 0.47 } });
  });
  await expect(freshImage).toHaveAttribute('width', '280');
  const resizedMap = await freshImage.getAttribute('href');
  await page.waitForTimeout(700);
  await expect(freshImage).toHaveAttribute('width', '280');
  await expect(freshImage).toHaveAttribute('href', resizedMap!);
  await expect(group).toHaveAttribute('data-ngs-render-members', '3');
});

test('in-flight rounded work cannot restore filters after Low or unmount', async ({ page }) => {
  await page.mouse.move(1300, 800);
  await page.evaluate(() => {
    const Native = window.Worker;
    window.Worker = new Proxy(Native, {
      construct(Target, args) {
        const worker = Reflect.construct(Target, args) as Worker;
        const send = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer) => setTimeout(() => Reflect.apply(send, worker, [message, transfer ?? []]), 250);
        return worker;
      },
    });
    window.glassTest.render({ count: 1, elasticity: 0.2 });
    window.glassTest.render({ count: 1, elasticity: 0.2, optics: { curvature: 0.123 } });
    window.glassTest.render({ count: 1, quality: 'low', optics: { curvature: 0.123 } });
  });
  await expect(page.locator('filter')).toHaveCount(0);
  await page.waitForTimeout(450);
  await expect(page.locator('filter')).toHaveCount(0);
  await page.evaluate(() => {
    window.glassTest.render({ count: 1, elasticity: 0.2, optics: { curvature: 0.456 } });
  });
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
  await page.evaluate(() => {
    window.glassTest.render({ count: 1, elasticity: 0.2, optics: { curvature: 0.789 } });
    window.glassTest.unmount();
  });
  await page.waitForTimeout(450);
  await expect(page.locator('filter')).toHaveCount(0);
});

test('worker load failures recover exactly; failed encoding releases the old optical graph', async ({ page }) => {
  await page.mouse.move(1300, 800);
  await page.evaluate(() => {
    const state = window as Window & { __workerStarts: number; __restoreEncode: () => void };
    state.__workerStarts = 0;
    const WorkerStub = class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      constructor() { state.__workerStarts++; }
      postMessage() { setTimeout(() => this.onerror?.(new ErrorEvent('error', { message: 'blocked worker load' })), 0); }
      terminate() {}
    };
    window.Worker = WorkerStub as unknown as typeof Worker;
    window.glassTest.render({ count: 3, elasticity: 0.2 });
    const encode = HTMLCanvasElement.prototype.toDataURL;
    state.__restoreEncode = () => { HTMLCanvasElement.prototype.toDataURL = encode; };
    HTMLCanvasElement.prototype.toDataURL = () => '';
    window.glassTest.render({ count: 3, elasticity: 0.2, optics: { curvature: 0.376 } });
  });
  await expect(page.locator('filter')).toHaveCount(0);
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /blur\(/);
  await page.evaluate(() => {
    (window as Window & { __restoreEncode: () => void }).__restoreEncode();
    window.glassTest.render({ count: 3, elasticity: 0.2, optics: { curvature: 0.377 } });
  });
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
  const starts = await page.evaluate(() => (window as Window & { __workerStarts: number }).__workerStarts);
  await page.evaluate(() => window.glassTest.render({ count: 3, elasticity: 0.2, optics: { curvature: 0.378 } }));
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
  expect(await page.evaluate(() => (window as Window & { __workerStarts: number }).__workerStarts)).toBe(starts);
});

test('offscreen glyph work starts one viewport ahead with the latest geometry', async ({ page }) => {
  await page.evaluate(() => window.glassTest.render({ count: 0, text: true, textSize: 68, textOffset: 4000 }));
  const text = page.locator('.ngs-text');
  await expect(text).toHaveAttribute('data-ngs-text-ready');
  await expect(text).not.toHaveAttribute('data-ngs-text-preview');
  await page.evaluate(() => window.glassTest.render({ count: 0, text: true, textSize: 92, textOffset: 4000, optics: { depth: 14 } }));
  await expect(text).toHaveAttribute('data-ngs-text-preview');
  await page.waitForTimeout(150);
  await expect(text).toHaveAttribute('data-ngs-text-preview');
  await page.evaluate(() => window.scrollTo(0, 3600));
  await expect(text).toHaveAttribute('data-ngs-text-ready');
  await page.waitForFunction(() => {
    const el = document.querySelector('.ngs-text') as HTMLElement & { __ngsRaster?: { pending: boolean } };
    return el.__ngsRaster?.pending === false;
  });
  await expect(text).toHaveCSS('font-size', '92px');
  await expect(page.locator('.ngs-text-tile[data-ngs-quality="high"]')).toHaveCount(9);
  await expect(text).not.toHaveAttribute('data-ngs-text-preview');
});
