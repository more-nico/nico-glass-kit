// Measures the scheduling trade-off separately from rendering throughput.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out=resolve('benchmarks/results/round2-latency');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BENCH_BROWSER_PATH,args:['--enable-gpu']});
const results=[];
try {
  for(let repetition=0;repetition<Number(process.env.BENCH_LATENCY_REPETITIONS??3);repetition++) for(const [label,url] of repetition%2 ? [['optimized','http://127.0.0.1:4178'],['previous','http://127.0.0.1:4179']] : [['previous','http://127.0.0.1:4179'],['optimized','http://127.0.0.1:4178']]) {
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,colorScheme:'dark'}),page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
    await page.goto(url+'/?count=100&mode=animated');await page.waitForFunction(()=>window.glassBenchmark?.ready);
    await page.evaluate(()=>{const background=document.getElementById('backdrop');background.replaceChildren();background.style.background='black';});
    await page.waitForTimeout(2500);
    const measurement=await page.evaluate(async()=>{
      const surfaces=[...document.querySelectorAll('#grid > .ngs-surface')].filter(e=>{const r=e.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;});
      const initiallyLight=surfaces.filter(e=>e.dataset.ngsLight==='true').length;
      const pending=new Set(surfaces),latencies=[];let running=true,start=0;
      const observer=new MutationObserver(()=>{for(const el of pending) if(el.dataset.ngsLight==='true'){latencies.push(performance.now()-start);pending.delete(el);}});
      observer.observe(document.getElementById('grid'),{attributes:true,subtree:true,attributeFilter:['data-ngs-light']});
      const background=document.getElementById('backdrop');
      const tick=()=>{if(running){background.style.transform=`translateX(${Math.sin(performance.now()/900)*45}px)`;requestAnimationFrame(tick);}};requestAnimationFrame(tick);
      start=performance.now();background.style.background='white';
      await new Promise(resolve=>{const poll=()=>{if(!pending.size||performance.now()-start>15000)resolve();else setTimeout(poll,20);};poll();});
      running=false;observer.disconnect();
      latencies.sort((a,b)=>a-b);
      return {count:surfaces.length,initiallyLight,completed:latencies.length,firstMs:latencies[0],medianMs:latencies[Math.floor(latencies.length/2)],lastMs:latencies.at(-1),latencies};
    });
    const row={label,repetition,...measurement,errors};results.push(row);console.log(JSON.stringify(row));await context.close();
  }
  await writeFile(resolve(out,'light-latency.json'),JSON.stringify({browser:browser.version(),collectedAt:new Date().toISOString(),cpuThrottle:6,results},null,2));
}finally{await browser.close();}
