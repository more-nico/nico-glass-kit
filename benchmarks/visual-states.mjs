import {chromium} from '@playwright/test';
import {PNG} from 'pngjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('benchmarks/results',process.argv[2]??'comparison'); await mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true,executablePath:process.env.BENCH_BROWSER_PATH,args:['--enable-gpu']});
const results=[];
try {
  for(const state of [{name:'hover',mode:'pointer',hover:true},{name:'group-hover',mode:'group',hover:true},{name:'glyph',mode:'idle',hover:false},{name:'medium',mode:'idle',hover:true,quality:'medium'},{name:'dense-settled',mode:'idle',count:100,hover:false}]) {
    for(const [label,url] of [['baseline','http://127.0.0.1:4179'],['optimized','http://127.0.0.1:4178']]) {
      const c=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,colorScheme:'dark'}),p=await c.newPage();
      await p.goto(`${url}/?count=${state.count??25}&mode=${state.mode}&quality=${state.quality??'high'}`);await p.waitForFunction(()=>window.glassBenchmark?.ready);await p.waitForTimeout(2500);
      await p.evaluate(()=>window.glassBenchmark.pose());
      if(state.hover) {const rect=await p.locator('#grid > .ngs-surface').first().boundingBox(); await p.mouse.move(rect.x+rect.width*0.8,rect.y+rect.height*0.3);}
      await p.waitForTimeout(1500);await p.screenshot({path:resolve(out,`${state.name}-${label}.png`)}); await c.close();
    }
    const a=PNG.sync.read(await readFile(resolve(out,`${state.name}-baseline.png`))),z=PNG.sync.read(await readFile(resolve(out,`${state.name}-optimized.png`)));
    let changed=0,max=0;for(let i=0;i<a.data.length;i+=4){const d=[0,1,2].map(k=>Math.abs(a.data[i+k]-z.data[i+k]));if(d.some(v=>v))changed++;max=Math.max(max,...d);}
    const pair=new PNG({width:a.width*2,height:a.height});PNG.bitblt(a,pair,0,0,a.width,a.height,0,0);PNG.bitblt(z,pair,0,0,z.width,z.height,a.width,0);
    await writeFile(resolve(out,`${state.name}-pair.png`),PNG.sync.write(pair));
    results.push({state:state.name,changedPixels:changed,maxChannelDelta:max});console.log(JSON.stringify(results.at(-1)));
  }
  await writeFile(resolve(out,'visual-states.json'),JSON.stringify(results,null,2));
}finally{await b.close();}
