import { PNG } from 'pngjs';
import { test, expect } from './fixtures';

test('batched peers preserve pixels, detach before hover and clean up in StrictMode', async ({ page }) => {
  await page.mouse.move(1300, 800);
  const options = { renderGroup: true, count: 3, quality: 'high' as const, elasticity: 0, boost: 0.5 };
  await page.evaluate(options => window.glassTest.render({ ...options, batchEnabled: false }), options);
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
  await page.waitForTimeout(350);
  const before = PNG.sync.read(await page.screenshot());
  await page.evaluate(options => window.glassTest.render(options), options);
  await expect(page.locator('.ngs-render-group')).toHaveAttribute('data-ngs-render-members', '3');
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', 'none');
  const after = PNG.sync.read(await page.screenshot());
  let max = 0, sum = 0;
  // Interiors must retain the filter/tint, including semi-transparent input.
  for (let y = 30; y < 80; y++) for (let x = 40; x < 200; x++) {
    const offset = (y * before.width + x) * 4;
    for (let c = 0; c < 3; c++) { const diff = Math.abs(before.data[offset + c] - after.data[offset + c]); max = Math.max(max, diff); sum += diff; }
  }
  expect(max).toBeLessThanOrEqual(2);
  expect(sum / (50 * 160 * 3)).toBeLessThan(0.2);
  await page.mouse.move(150, 60);
  const effect = page.locator('[data-test="surface-0"] .ngs-effect');
  await expect(effect).toHaveCSS('backdrop-filter', /url\(/);
  const id = await effect.getAttribute('data-ngs-individual-filter');
  await expect(page.locator(`[id="${id}"] feFuncR`)).toHaveAttribute('slope', '1.6');
  await page.mouse.move(1300, 800);
  await expect(effect).toHaveCSS('backdrop-filter', 'none');
  await page.evaluate(options => window.glassTest.render({ ...options, batchEnabled: false }), options);
  await expect(page.locator('.ngs-render-layer')).toHaveCount(0);
  await expect(effect).toHaveCSS('backdrop-filter', /url\(/);
  await page.evaluate(options => window.glassTest.render({ ...options, quality: 'low' }), options);
  await expect(page.locator('filter')).toHaveCount(0);
  await expect(effect).toHaveCSS('backdrop-filter', /blur\(3px\)/);
});

test('overlap and painted intermediate wrappers opt out without losing the private filter', async ({ page }) => {
  await page.mouse.move(1300, 800);
  await page.evaluate(() => window.glassTest.render({ renderGroup: true, elasticity: 0 }));
  await expect(page.locator('.ngs-render-group')).toHaveAttribute('data-ngs-render-members', '3');
  await page.locator('[data-test="surface-1"]').evaluate(el => { (el as HTMLElement).style.transform = 'translateX(-200px)'; });
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
  await expect(page.locator('[data-test="surface-1"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
  await page.locator('[data-test="surface-1"]').evaluate(el => { (el as HTMLElement).style.transform = ''; });
  await expect(page.locator('.ngs-render-group')).toHaveAttribute('data-ngs-render-members', '3');
  await page.locator('[data-test="surface-0"]').evaluate(el => { el.parentElement!.style.backgroundColor = 'rgb(200, 20, 30)'; });
  await expect(page.locator('.ngs-render-layer')).toHaveCount(0);
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
});

test('regrouping insertion and removal keeps actual filter ownership and holes consistent', async ({ page }) => {
  await page.mouse.move(1400, 850);
  for (const count of [6, 7, 4, 7, 6]) {
    await page.evaluate(count => window.glassTest.render({ renderGroup: true, elasticity: 0, count, width: 180 }), count);
    await expect.poll(() => page.locator('.ngs-render-group').getAttribute('data-ngs-render-members')).not.toBe('0');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-ngs-render-batched="true"]')].every(effect => {
      const id = (effect as HTMLElement & { __ngsBatchFilter?: string }).__ngsBatchFilter;
      const filter = id && document.getElementById(id);
      const layer = [...document.querySelectorAll<HTMLElement>('.ngs-render-layer')].find(layer => layer.style.backdropFilter.includes(`#${id}`));
      const maskId = layer?.style.maskImage.match(/#([^"')]+)/)?.[1];
      const mask = maskId && document.getElementById(maskId);
      return !!filter && !!mask && [...mask.children].some(hole => hole.getAttribute('display') !== 'none');
    }))).toBe(true);
  }
});

test('decoding and keyboard activity keep the private filter until sharing is safe', async ({ page }) => {
  await page.mouse.move(1300, 800);
  await page.evaluate(() => {
    const state = window as Window & { __pendingDecodes: Array<() => void>; __releaseDecodes: () => void };
    state.__pendingDecodes = [];
    let held = true;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function() {
      await decode.call(this);
      if (held) await new Promise<void>(resolve => state.__pendingDecodes.push(resolve));
    };
    state.__releaseDecodes = () => { held = false; state.__pendingDecodes.forEach(resolve => resolve()); };
    window.glassTest.render({ renderGroup: true, elasticity: 0 });
  });
  const surface = page.locator('[data-test="surface-0"]');
  await expect.poll(() => page.evaluate(() => (window as Window & { __pendingDecodes: unknown[] }).__pendingDecodes.length)).toBeGreaterThan(0);
  await expect(surface.locator('.ngs-effect')).toHaveCSS('backdrop-filter', /url\(/);
  await surface.focus(); await page.keyboard.down('Space');
  await page.evaluate(() => (window as Window & { __releaseDecodes: () => void }).__releaseDecodes());
  await page.waitForTimeout(100);
  await expect(surface.locator('.ngs-effect')).not.toHaveAttribute('data-ngs-render-batched', 'true');
  await page.keyboard.up('Space');
  await expect(page.locator('.ngs-render-group')).toHaveAttribute('data-ngs-render-members', '3');
  await surface.evaluate(el => {
    const input = document.createElement('input'); input.id = 'group-typing';
    Object.assign(input.style, {position:'absolute',top:'20px',left:'20px',width:'100px'}); el.append(input);
  });
  await page.locator('#group-typing').focus(); await page.keyboard.down('Space');
  await expect(page.locator('.ngs-render-group')).toHaveAttribute('data-ngs-render-members', '3');
  await page.keyboard.up('Space');
});

test('geometry animations detach until settled; retained content spinners keep sharing', async ({ page }) => {
  await page.mouse.move(1300, 800);
  await page.evaluate(() => window.glassTest.render({ renderGroup: true, elasticity: 0 }));
  const surface = page.locator('[data-test="surface-0"]');
  const effect = surface.locator('.ngs-effect');
  await expect(effect).toHaveAttribute('data-ngs-render-batched', 'true');
  await page.addStyleTag({ content: '@keyframes dual-group {from {transform:scale(1)} to {transform:scale(.9)}}' });
  await surface.evaluate(el => { el.style.animation = 'dual-group 60ms linear, dual-group 500ms linear'; });
  await page.waitForTimeout(150);
  await expect(effect).not.toHaveAttribute('data-ngs-render-batched', 'true');
  await expect(effect).toHaveAttribute('data-ngs-render-batched', 'true');
  await surface.locator('.ngs-motion').evaluate(el => { el.style.opacity = '0.5'; });
  await expect(effect).not.toHaveAttribute('data-ngs-render-batched', 'true');
  await surface.locator('.ngs-motion').evaluate(el => { el.style.opacity = '1'; });
  await expect(effect).toHaveAttribute('data-ngs-render-batched', 'true');
  const group = page.locator('.ngs-render-group');
  await expect(group).toHaveAttribute('data-ngs-render-members', '3');
  await page.addStyleTag({ content: '@keyframes retained-spin {to {transform:rotate(360deg)}} @keyframes content-layout {from {width:10px} to {width:30px}} .retained-spinner {display:inline-block;animation:retained-spin 300ms linear infinite}' });
  await page.locator('[data-test="surface-0"] .ngs-content').evaluate(el => {
    const icon = document.createElement('span'); icon.className = 'retained-spinner'; icon.textContent = '↻'; el.append(icon);
  });
  await page.waitForTimeout(400);
  await expect(group).toHaveAttribute('data-ngs-render-members', '3');
  await page.locator('.retained-spinner').evaluate(el => el.remove());
  await expect(group).toHaveAttribute('data-ngs-render-members', '3');
  await page.locator('[data-test="surface-0"] .ngs-content').evaluate(el => {
    const content = document.createElement('span'); content.id = 'content-layout';
    content.style.cssText = 'display:inline-block;animation:content-layout 600ms linear,retained-spin 300ms linear infinite'; el.append(content);
  });
  await expect(group).toHaveAttribute('data-ngs-render-members', '0');
  await expect(group).toHaveAttribute('data-ngs-render-members', '3');
});

test('nested spring activity suspends ancestors once and recovers on leave or unmount', async ({ page }) => {
  await page.mouse.move(1300, 800);
  await page.evaluate(() => window.glassTest.render({ renderGroup: true, nestedRenderGroup: true, elasticity: 0 }));
  const outer = page.locator('[data-test="outer-render-group"]');
  const inner = page.locator('[data-test="inner-render-group"]');
  await expect(outer).toHaveAttribute('data-ngs-render-members', '3');
  await expect(inner).toHaveAttribute('data-ngs-render-members', '3');
  await page.locator('[data-test="inner-0"]').hover();
  await expect(outer).toHaveAttribute('data-ngs-render-members', '0');
  await page.mouse.move(1300, 800);
  await expect(outer).toHaveAttribute('data-ngs-render-members', '3');
  await expect(inner).toHaveAttribute('data-ngs-render-members', '3');
  await page.locator('[data-test="inner-0"]').hover();
  await expect(outer).toHaveAttribute('data-ngs-render-members', '0');
  await page.evaluate(() => window.glassTest.render({ renderGroup: true, elasticity: 0 }));
  await expect(outer).toHaveAttribute('data-ngs-render-members', '3');
});
