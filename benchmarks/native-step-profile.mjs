// Diagnostic timing only; never use these instrumented frames as FPS evidence.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out='benchmarks/results/round2-native';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BENCH_BROWSER_PATH,args:['--enable-gpu']});
const results=[];
try {
  for(const [label,url]of[['previous','http://127.0.0.1:4179'],['optimized','http://127.0.0.1:4178']]) {
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,colorScheme:'dark'}),page=await context.newPage();
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
    await page.goto(url+'/?count=100&mode=animated');await page.waitForFunction(()=>window.glassBenchmark?.ready);await page.waitForTimeout(2500);
    const row=await page.evaluate(async()=>{
      const originalRAF=requestAnimationFrame,originalHit=document.elementsFromPoint.bind(document);
      let frame=0;const hits=[];
      window.requestAnimationFrame=callback=>originalRAF(time=>{frame=time;callback(time);});
      document.elementsFromPoint=(x,y)=>{const start=performance.now(),stack=originalHit(x,y);if(hits.length<1500)hits.push({frame,cost:performance.now()-start,x,y});return stack;};
      await window.glassBenchmark.measure(3000,'animated');
      window.requestAnimationFrame=originalRAF;document.elementsFromPoint=originalHit;
      const grouped=new Map();for(const hit of hits){if(!grouped.has(hit.frame))grouped.set(hit.frame,[]);grouped.get(hit.frame).push(hit.cost);}
      const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
      return {frames:grouped.size,hits:hits.length,pointsPerFrame:median([...grouped.values()].map(a=>a.length)),firstCostMs:median([...grouped.values()].map(a=>a[0])),continuationCostMs:median([...grouped.values()].flatMap(a=>a.slice(1))),sample:hits.slice(0,80)};
    });
    results.push({label,...row});console.log(JSON.stringify(results.at(-1)));await context.close();
  }
  await writeFile(out+'/profile.json',JSON.stringify(results,null,2));
}finally{await browser.close();}
