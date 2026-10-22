import { test, expect } from './fixtures';

test('fixed wallpaper, sticky positioning and inner scrolling update independent light samples', async ({ page }) => {
  await page.mouse.move(1400, 850);
  await page.evaluate(() => {
    window.glassTest.render({ auto: true, elasticity: 0 });
    const background = document.getElementById('background')!;
    background.style.background = 'black';
    background.innerHTML = '<div style="position:absolute;inset:0 0 auto;height:450px;background:white"></div>';
    const surfaces = [...document.querySelectorAll<HTMLElement>('[data-test^="surface-"]')];
    Object.assign(surfaces[0].style, { position: 'fixed', top: '20px', left: '20px', margin: '0', zIndex: '2' });
    Object.assign(surfaces[1].style, { display: 'block', position: 'sticky', top: '160px', marginTop: '600px' });
    Object.assign(surfaces[2].style, { position: 'fixed', top: '20px', left: '600px', margin: '0', zIndex: '2' });
    surfaces[1].parentElement!.style.height = '2400px';
    const scroller = document.createElement('div');
    scroller.id = 'light-inner-scroll';
    Object.assign(scroller.style, { position: 'fixed', left: '600px', top: '20px', width: '260px', height: '120px', overflow: 'auto', zIndex: '1' });
    scroller.innerHTML = '<div style="height:120px;background:white"></div><div style="height:120px;background:black"></div>';
    document.body.append(scroller);
  });
  const fixed = page.locator('[data-test="surface-0"]');
  const sticky = page.locator('[data-test="surface-1"]');
  const inner = page.locator('[data-test="surface-2"]');
  await expect(fixed).toHaveAttribute('data-ngs-light', 'true');
  await expect(sticky).toHaveAttribute('data-ngs-light', 'false');
  await expect(inner).toHaveAttribute('data-ngs-light', 'true');
  await page.evaluate(() => window.scrollTo(0, 550));
  await expect(sticky).toHaveAttribute('data-ngs-light', 'true');
  await expect(fixed).toHaveAttribute('data-ngs-light', 'true');
  await page.locator('#light-inner-scroll').evaluate(el => { el.scrollTop = 120; });
  await expect(inner).toHaveAttribute('data-ngs-light', 'false');
  await expect(fixed).toHaveAttribute('data-ngs-light', 'true');
});
