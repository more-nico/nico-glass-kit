import { test, expect, type Page } from '@playwright/test';
declare global { interface Window { glassTest: { render(options?:Record<string,unknown>):void; unmount():void; probeBackground():unknown; stats(): {cache:{generated:number};images:{size:number;bytes:number;evictions:number;pending:number;activeDecodes:number};filters:number;clicks:number} }; __activeResizeObservers:number; __imageCreates:number; __maxImageDecodes:number; } }
async function ready(page:Page, options?:Record<string,unknown>) {
  if(options) await page.evaluate(o=>window.glassTest.render(o),options);
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter',/url\(/);
}
test.beforeEach(async ({page})=>{
  await page.addInitScript(()=>{
    const Native=window.ResizeObserver;
    window.__activeResizeObservers=0;
    window.ResizeObserver=class extends Native {
      active=false;
      observe(target:Element,options?:ResizeObserverOptions) {if(!this.active){this.active=true;window.__activeResizeObservers++;}super.observe(target,options);}
      disconnect(){if(this.active){this.active=false;window.__activeResizeObservers--;}super.disconnect();}
    };
  });
  await page.goto('/regression.html'); await page.waitForFunction(()=>!!window.glassTest);
});
test('StrictMode, filter sharing, namespace isolation and final-owner cleanup',async({page})=>{
  await ready(page,{quality:'medium',count:30,nested:true});
  await expect(page.locator('filter')).toHaveCount(2);
  const ids=await page.locator('filter').evaluateAll(nodes=>nodes.map(n=>n.id)); expect(new Set(ids).size).toBe(2);
  await ready(page,{quality:'high',count:30,elasticity:0}); await expect(page.locator('filter')).toHaveCount(1);
  await ready(page,{quality:'high',count:30,elasticity:0.2}); await expect(page.locator('filter')).toHaveCount(30);
  expect(await page.evaluate(()=>window.__activeResizeObservers)).toBe(1);
  await page.evaluate(()=>window.glassTest.unmount()); await expect(page.locator('filter')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__activeResizeObservers)).toBe(0);
});
test('hover brightness stays private, elasticity/glint track the pointer without rasterizing',async({page})=>{
  await ready(page,{quality:'high',boost:0.5});
  const before=await page.evaluate(()=>window.glassTest.stats().cache.generated);
  const effect=page.locator('[data-test="surface-0"] .ngs-effect'); const id=(await effect.evaluate(e=>getComputedStyle(e).backdropFilter)).match(/#([^\)"']+)/)![1];
  const box=(await page.locator('[data-test="surface-0"]').boundingBox())!;
  await page.mouse.move(box.x+200,box.y+50);
  await expect(page.locator(`#${id} feFuncR`)).toHaveAttribute('slope','1.6');
  await expect(page.locator('[data-test="surface-0"] .ngs-highlight')).toHaveCSS('--ngx','83.33%');
  expect(await page.locator('[data-test="surface-1"] .ngs-motion').evaluate(e=>(e as HTMLElement).style.transform)).toBe('');
  await page.mouse.move(1300,800); await expect(page.locator(`#${id} feFuncR`)).toHaveAttribute('slope','1.1');
  expect(await page.evaluate(()=>window.glassTest.stats().cache.generated)).toBe(before);
  await page.locator('[data-test="surface-0"]').click(); expect(await page.evaluate(()=>window.glassTest.stats().clicks)).toBe(1);
});
test('live resize, optics changes and DPR changes replace maps without leaking filter nodes',async({page})=>{
  await ready(page);
  for(let i=0;i<12;i++) {await ready(page,{width:240+i,radius:20+i}); await page.waitForTimeout(150);}
  await expect(page.locator('filter')).toHaveCount(3);
  await ready(page,{optics:{refraction:0.4,depth:14,dispersion:0.4}});
  await expect.poll(async()=>Number(await page.locator('filter feDisplacementMap').nth(1).getAttribute('scale'))).toBeCloseTo(0.4*24*(255/127),5);
  const before=await page.locator('filter feImage').first().getAttribute('href');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:2,mobile:false});
  await expect.poll(()=>page.locator('filter feImage').first().getAttribute('href')).not.toBe(before);
  await expect(page.locator('filter')).toHaveCount(3);
  await page.evaluate(()=>window.glassTest.unmount()); await expect(page.locator('filter')).toHaveCount(0);
});
test('auto light updates, glyph masks and tier transitions remain functional',async({page})=>{
  await ready(page,{auto:true,text:true});
  await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-light','false');
  await page.evaluate(()=>document.getElementById('background')!.style.backgroundColor='#ffffff');
  await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-light','true');
  await expect(page.locator('.ngs-text')).toHaveAttribute('data-ngs-text-ready','');
  expect(await page.locator('[data-ngs-shape="glyph"]').count()).toBe(9);
  await page.evaluate(()=>window.glassTest.render({quality:'low',text:true}));
  await expect(page.locator('filter')).toHaveCount(0);
  await ready(page,{quality:'high',text:true});
});
test('Firefox/Safari capability routing retains the CSS fallback',async({browser})=>{
  for(const userAgent of ['Mozilla/5.0 Firefox/144.0','Mozilla/5.0 Version/18.0 Safari/605.1.15']) {
    const context=await browser.newContext({userAgent}); const page=await context.newPage();
    await page.goto('/regression.html'); await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-quality','low');
    await expect(page.locator('filter')).toHaveCount(0); await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter',/blur\(/);
    await context.close();
  }
});
test('failed canvas encoding preserves readable text and CSS glass',async({browser})=>{
  const context=await browser.newContext(); const page=await context.newPage();
  await page.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>null;});
  await page.goto('/regression.html'); await page.waitForFunction(()=>!!window.glassTest);
  await page.evaluate(()=>window.glassTest.render({text:true})); await page.waitForTimeout(400);
  await expect(page.locator('filter')).toHaveCount(0);
  await expect(page.locator('.ngs-text-fallback')).toHaveText('GLASS 2026');
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter',/blur\(/);
  await context.close();
});

test('slow native hit-tests yield between points and still update all surfaces',async({page})=>{
  await ready(page,{auto:true,count:3});
  await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-light','false');
  await page.evaluate(()=>{
    const original=document.elementsFromPoint.bind(document);
    let frame=0;const hits=new Map<number,number>();
    const tick=()=>{frame++;requestAnimationFrame(tick);};requestAnimationFrame(tick);
    document.elementsFromPoint=(x,y)=>{
      const end=performance.now()+4;while(performance.now()<end) { /* Simulate a slow indivisible native call. */ }
      hits.set(frame,(hits.get(frame)??0)+1);return original(x,y);
    };
    (window as unknown as {maxProbeHits:()=>number}).maxProbeHits=()=>Math.max(0,...hits.values());
    (window as unknown as {firstProbeHits:()=>number}).firstProbeHits=()=>hits.values().next().value ?? 0;
    (window as unknown as {probeHitCount:()=>number}).probeHitCount=()=>[...hits.values()].reduce((a,b)=>a+b,0);
    (window as unknown as {finishSlowProbe:()=>void}).finishSlowProbe=()=>{document.elementsFromPoint=original;};
    document.getElementById('background')!.style.transform='translateX(1px)';
  });
  await page.waitForFunction(()=>(window as unknown as {probeHitCount:()=>number}).probeHitCount()>=27);
  // A new slow grid yields after its first point; resumed grids can take a
  // bounded 16ms catch-up slice. They must never burst through all nine points.
  expect(await page.evaluate(()=>(window as unknown as {maxProbeHits:()=>number}).maxProbeHits())).toBeLessThanOrEqual(4);
  expect(await page.evaluate(()=>(window as unknown as {firstProbeHits:()=>number}).firstProbeHits())).toBe(1);
  await page.evaluate(()=>{(window as unknown as {finishSlowProbe:()=>void}).finishSlowProbe();document.getElementById('background')!.style.backgroundColor='#ffffff';});
  for(let i=0;i<3;i++) await expect(page.locator(`[data-test="surface-${i}"]`)).toHaveAttribute('data-ngs-light','true');
  await page.evaluate(()=>window.glassTest.unmount());await expect(page.locator('filter')).toHaveCount(0);
});

test('light-group membership changes discard partly sampled work and preserve one group decision',async({page})=>{
  await ready(page,{auto:true,lightGroup:true,count:3});
  await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-light','false');
  await page.evaluate(()=>{
    const original=document.elementsFromPoint.bind(document);
    document.elementsFromPoint=(x,y)=>{const end=performance.now()+1;while(performance.now()<end){}return original(x,y);};
    document.getElementById('background')!.style.backgroundColor='#ffffff';
    requestAnimationFrame(()=>window.glassTest.render({auto:true,lightGroup:true,count:4}));
  });
  await expect(page.locator('[data-test]')).toHaveCount(4);
  for(let i=0;i<4;i++) await expect(page.locator(`[data-test="surface-${i}"]`)).toHaveAttribute('data-ngs-light','true');
  await page.evaluate(()=>window.glassTest.unmount());await expect(page.locator('filter')).toHaveCount(0);
});

test('pathological glyph dimensions preserve readable text without allocating a huge distance field',async({page})=>{
  await ready(page,{text:true,textSize:4000});
  await expect(page.locator('.ngs-text-fallback')).toHaveText('GLASS 2026');
  await expect(page.locator('[data-ngs-shape="glyph"]')).toHaveCount(0);
  await expect(page.locator('[data-test="surface-0"] .ngs-effect')).toHaveCSS('backdrop-filter',/url\(/);
});

test('background image cycling keeps decoded copies bounded and light decisions readable',async({page})=>{
  await ready(page,{auto:true,count:1});
  for(let i=0;i<40;i++) {
    await page.evaluate(i=>{
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><metadata>${i}</metadata><rect width="32" height="32" fill="white"/></svg>`;
      document.getElementById('background')!.style.backgroundImage=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    },i);
    await page.evaluate(()=>window.glassTest.probeBackground());
    await expect.poll(()=>page.evaluate(()=>window.glassTest.stats().images.pending)).toBe(0);
  }
  const images=await page.evaluate(()=>window.glassTest.stats().images);
  expect(images.size).toBeLessThanOrEqual(32);expect(images.evictions).toBeGreaterThanOrEqual(8);
  await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-light','true');
});

test('an image working set larger than the LRU settles once and preserves exact geometry samples',async({page})=>{
  await page.evaluate(()=>window.glassTest.render({auto:true,count:40,width:80,quality:'low'}));
  await expect(page.locator('[data-test]')).toHaveCount(40);
  await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-light','false');
  await page.evaluate(()=>{
    window.__imageCreates=0;window.__maxImageDecodes=0;
    window.Image=new Proxy(window.Image,{construct(target,args){
      window.__imageCreates++;
      window.__maxImageDecodes=Math.max(window.__maxImageDecodes,window.glassTest.stats().images.activeDecodes+1);
      return Reflect.construct(target,args);
    }});
    document.querySelectorAll<HTMLElement>('[data-test]').forEach((surface,i)=>{
      const box=surface.getBoundingClientRect(),paint=document.createElement('div');
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><metadata>${i}</metadata><rect width="32" height="32" fill="white"/></svg>`;
      paint.id=`image-paint-${i}`;
      Object.assign(paint.style,{position:'absolute',left:`${box.x}px`,top:`${box.y}px`,width:`${box.width}px`,height:`${box.height}px`,backgroundImage:`url("data:image/svg+xml,${encodeURIComponent(svg)}")`,backgroundSize:'cover',backgroundPosition:'center'});
      surface.before(paint);
    });
  });
  await expect(page.locator('[data-test][data-ngs-light="true"]')).toHaveCount(40);
  await expect.poll(()=>page.evaluate(()=>window.glassTest.stats().images.pending)).toBe(0);
  expect(await page.evaluate(()=>window.__maxImageDecodes)).toBeLessThanOrEqual(4);
  expect(await page.evaluate(()=>window.glassTest.stats().images.size)).toBeLessThanOrEqual(32);
  expect(await page.evaluate(()=>window.__imageCreates)).toBe(40);
  // An image-settled notification must not keep resurrecting evicted images.
  await page.waitForTimeout(500);
  expect(await page.evaluate(()=>window.__imageCreates)).toBe(40);
  await page.evaluate(()=>{
    const paint=document.getElementById('image-paint-0')!;
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="black"/><rect width="16" height="32" fill="#bbb"/></svg>';
    paint.style.width='160px';
    paint.style.backgroundImage=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  });
  await expect.poll(()=>page.evaluate(()=>window.__imageCreates)).toBe(41);
  await expect.poll(()=>page.evaluate(()=>window.glassTest.stats().images.pending)).toBe(0);
  await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-light','true');
  // The resized cover image puts two of the three columns over black. Reusing
  // a whole-image average or old coordinates would keep the wrong decision.
  await page.evaluate(()=>{document.getElementById('image-paint-0')!.style.width='80px';});
  await expect(page.locator('[data-test="surface-0"]')).toHaveAttribute('data-ngs-light','false');
  expect(await page.evaluate(()=>window.__imageCreates)).toBe(41);
  // Stalled decodes must not keep removed nodes/queued images alive, or start
  // the rest of the queue after unmount. Routes are intercepted locally.
  await page.route('https://example.invalid/glass-image-*',()=>{});
  await page.evaluate(()=>{
    for(let i=0;i<40;i++) document.getElementById(`image-paint-${i}`)!.style.backgroundImage=`url("https://example.invalid/glass-image-${i}")`;
  });
  await expect.poll(()=>page.evaluate(()=>window.glassTest.stats().images.pending)).toBe(40);
  expect(await page.evaluate(()=>window.glassTest.stats().images.activeDecodes)).toBe(4);
  const creates=await page.evaluate(()=>window.__imageCreates);
  await page.evaluate(()=>window.glassTest.unmount());
  await expect.poll(()=>page.evaluate(()=>window.glassTest.stats().images.pending)).toBe(0);
  expect(await page.evaluate(()=>window.glassTest.stats().images.activeDecodes)).toBe(0);
  expect(await page.evaluate(()=>window.__imageCreates)).toBe(creates);
});
