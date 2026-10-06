import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const b = await chromium.launch({ headless:true, executablePath:process.env.BENCH_BROWSER_PATH, args:['--enable-gpu'] });
const results=[];
try {
  for (const [label,url] of [['baseline','http://127.0.0.1:4179'],['optimized','http://127.0.0.1:4178']]) {
    const c=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2}), p=await c.newPage();
    const d=await c.newCDPSession(p);
    await p.goto(url+'/?count=100&mode=group'); await p.waitForFunction(()=>window.glassBenchmark?.ready); await p.waitForTimeout(3000);
    await d.send('HeapProfiler.collectGarbage');
    const mounted={heap:await d.send('Runtime.getHeapUsage'),dom:await d.send('Memory.getDOMCounters'),stats:await p.evaluate(()=>window.glassBenchmark.stats())};
    await p.evaluate(()=>window.glassBenchmark.measure(5000,'resize'));
    await p.evaluate(()=>window.glassBenchmark.churn(8));
    await d.send('HeapProfiler.collectGarbage');
    const unmounted={heap:await d.send('Runtime.getHeapUsage'),dom:await d.send('Memory.getDOMCounters'),stats:await p.evaluate(()=>window.glassBenchmark.stats())};
    results.push({label,mounted,unmounted}); console.log(JSON.stringify(results.at(-1)));
    await c.close();
  }
  const out=resolve('benchmarks/results',process.argv[2]??'comparison');await mkdir(out,{recursive:true}); await writeFile(resolve(out,'retention.json'),JSON.stringify(results,null,2));
}finally{await b.close();}
