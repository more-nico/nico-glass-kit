// Instrumentation is diagnostic only; use run.mjs for uninstrumented measurements.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const label = process.argv[2] ?? 'probe-profile';
const out = resolve('benchmarks/results', label);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BENCH_BROWSER_PATH, args: ['--enable-gpu'] });
try {
  const context = await browser.newContext({ viewport: { width:1440, height:900 }, deviceScaleFactor:2, colorScheme:'dark' });
  const page = await context.newPage();
  await page.goto(process.env.BENCH_URL ?? 'http://127.0.0.1:4179/?count=100&mode=animated');
  await page.waitForFunction(() => window.glassBenchmark?.ready);
  await page.waitForTimeout(3000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const data = await page.evaluate(async () => {
    const hitTest = document.elementsFromPoint.bind(document);
    const rect = Element.prototype.getBoundingClientRect;
    const style = window.getComputedStyle;
    const data = { hitCount:0, hitMs:0, rectCount:0, styleCount:0, hits: {}, samples: [] };
    document.elementsFromPoint = (x,y) => {
      const start = performance.now(); const elements = hitTest(x,y);
      const ms = performance.now() - start; data.hitCount++; data.hitMs += ms;
      if(data.samples.length < 5) data.samples.push({ ms, elements:elements.map(e => e.className) });
      for(const e of elements) data.hits[String(e.className)] = (data.hits[String(e.className)] ?? 0) + 1;
      return elements;
    };
    Element.prototype.getBoundingClientRect = function() { data.rectCount++; return rect.call(this); };
    window.getComputedStyle = function(...args) { data.styleCount++; return style.apply(this,args); };
    await window.glassBenchmark.measure(5000,'animated');
    document.elementsFromPoint = hitTest; Element.prototype.getBoundingClientRect = rect; window.getComputedStyle = style;
    return data;
  });
  console.log(JSON.stringify(data,null,2));
  await writeFile(resolve(out,'probes.json'),JSON.stringify(data,null,2));
  await cdp.send('Profiler.enable'); await cdp.send('Debugger.enable'); await cdp.send('Profiler.start');
  await page.evaluate(() => window.glassBenchmark.measure(5000,'animated'));
  const { profile } = await cdp.send('Profiler.stop');
  const times = new Map();
  for(let i=0;i<profile.samples.length;i++) times.set(profile.samples[i],(times.get(profile.samples[i])??0)+profile.timeDeltas[i]);
  const sources = new Map();
  for(const n of profile.nodes) if(n.callFrame.url.startsWith('http')&&!sources.has(n.callFrame.scriptId)) {
    sources.set(n.callFrame.scriptId,(await cdp.send('Debugger.getScriptSource',{scriptId:n.callFrame.scriptId})).scriptSource.split('\n'));
  }
  const top = profile.nodes.map(n=>({name:n.callFrame.functionName,ms:(times.get(n.id)??0)/1000,source:sources.get(n.callFrame.scriptId)?.[n.callFrame.lineNumber]?.slice(n.callFrame.columnNumber,n.callFrame.columnNumber+160)})).sort((a,b)=>b.ms-a.ms).slice(0,20);
  console.log(JSON.stringify(top,null,2));
  await writeFile(resolve(out,'top.json'),JSON.stringify(top,null,2));
  await writeFile(resolve(out,'cpu-profile.json'),JSON.stringify(profile));
  await context.close();
} finally { await browser.close(); }
