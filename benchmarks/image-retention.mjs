import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out=resolve('benchmarks/results',process.argv[2]??'round2-memory');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BENCH_BROWSER_PATH,args:['--enable-gpu']});
const results=[];
try {
  for(const [label,url] of [['previous','http://127.0.0.1:4179'],['optimized','http://127.0.0.1:4178']]) {
    const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
    const page=await context.newPage(),cdp=await context.newCDPSession(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const NativeImage=window.Image;window.__probeImagesLoaded=0;
      window.Image=function(...args){const image=new NativeImage(...args);image.dataset.probeOwned='true';image.addEventListener('load',()=>window.__probeImagesLoaded++);return image;};
    });
    await page.goto(url+'/?count=1&mode=idle');await page.waitForFunction(()=>window.glassBenchmark?.ready);await page.waitForTimeout(1000);
    await page.evaluate(()=>{
      document.querySelectorAll('.lines,.orb').forEach(e=>e.remove());
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});const gradient=ctx.createLinearGradient(0,0,1024,1024);
      gradient.addColorStop(0,'#fff');gradient.addColorStop(1,'#ccc');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,1024);
      window.__cycleImage=i=>{ctx.fillStyle=`rgb(${i} 0 0)`;ctx.fillRect(0,0,8,8);document.getElementById('backdrop').style.backgroundImage=`url("${canvas.toDataURL()}")`;};
    });
    for(let i=0;i<40;i++) {
      await page.evaluate(i=>window.__cycleImage(i),i);
      await page.waitForFunction(count=>window.__probeImagesLoaded>=count,i+1);
    }
    await page.waitForTimeout(500);await cdp.send('HeapProfiler.collectGarbage');
    const {result}=await cdp.send('Runtime.evaluate',{expression:'HTMLImageElement.prototype'});
    const {objects}=await cdp.send('Runtime.queryObjects',{prototypeObjectId:result.objectId});
    const count=await cdp.send('Runtime.callFunctionOn',{objectId:objects.objectId,functionDeclaration:'function(){return this.filter(image=>image.dataset.probeOwned === "true").length;}',returnByValue:true});
    await cdp.send('Runtime.releaseObject',{objectId:objects.objectId});await cdp.send('Runtime.releaseObject',{objectId:result.objectId});
    const row={label,cycles:40,retainedDecodedCopies:count.result.value,heap:await cdp.send('Runtime.getHeapUsage'),errors};
    results.push(row);console.log(JSON.stringify(row));await context.close();
  }
  await writeFile(resolve(out,'image-retention.json'),JSON.stringify({browser:browser.version(),collectedAt:new Date().toISOString(),results},null,2));
} finally {await browser.close();}
