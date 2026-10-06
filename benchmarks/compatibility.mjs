import {firefox,webkit} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('benchmarks/results',process.argv[2]??'comparison');await mkdir(out,{recursive:true});const results=[];
for(const [name,type,path] of [
  ['firefox',firefox,process.env.BENCH_FIREFOX_PATH],
  ['webkit',webkit,process.env.BENCH_WEBKIT_PATH],
]) {
  let browser;
  try {
    browser=await type.launch({headless:true,...(path?{executablePath:path}:{})});
    const states=[];
    for(const [label,url]of[['baseline','http://127.0.0.1:4179'],['optimized','http://127.0.0.1:4178']]) {
      const c=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,colorScheme:'dark'}),p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
      await p.goto(url+'/?count=25');await p.waitForFunction(()=>window.glassBenchmark?.ready);await p.waitForTimeout(3000);
      const state=await p.evaluate(()=>({qualities:[...new Set([...document.querySelectorAll('.ngs-surface')].map(e=>e.dataset.ngsQuality))],filters:document.querySelectorAll('filter').length,backdrop:getComputedStyle(document.querySelector('.ngs-effect')).backdropFilter,glyphReady:document.querySelector('.ngs-text').hasAttribute('data-ngs-text-ready')}));
      states.push({label,...state,errors});await p.screenshot({path:resolve(out,`${name}-${label}.png`)});await c.close();
    }
    if(states.some(s=>s.qualities.some(q=>q!=='low')||s.filters!==0||s.errors.length||!s.glyphReady))throw Error('Fallback regression: '+JSON.stringify(states));
    results.push({name,version:browser.version(),states,passed:true});
  }catch(e){results.push({name,passed:false,error:String(e)});}finally{await browser?.close();}
}
await writeFile(resolve(out,'compatibility.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
