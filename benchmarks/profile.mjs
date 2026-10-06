import { chromium } from '@playwright/test';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out = resolve('benchmarks/results/profile'); await mkdir(out, { recursive:true });
const b = await chromium.launch({headless:true,executablePath:process.env.BENCH_BROWSER_PATH,args:['--enable-gpu']});
try {
  const p = await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  await p.goto(process.env.BENCH_URL ?? 'http://127.0.0.1:4179/?count=100');
  await p.waitForFunction(()=>window.glassBenchmark?.ready); await p.waitForTimeout(3000);
  const c = await p.context().newCDPSession(p); await c.send('Profiler.enable'); await c.send('Debugger.enable'); await c.send('Profiler.start');
  await p.evaluate(()=>window.glassBenchmark.measure(5000,'animated'));
  const { profile } = await c.send('Profiler.stop');
  await writeFile(resolve(out,'cpu-profile.json'),JSON.stringify(profile));
  const times=new Map(); for(let i=0;i<profile.samples.length;i++) times.set(profile.samples[i],(times.get(profile.samples[i])??0)+profile.timeDeltas[i]);
  const sources=new Map();
  for(const n of profile.nodes) if(n.callFrame.url.startsWith('http')&&!sources.has(n.callFrame.scriptId)) {
    sources.set(n.callFrame.scriptId,(await c.send('Debugger.getScriptSource',{scriptId:n.callFrame.scriptId})).scriptSource.split('\n'));
  }
  const top=profile.nodes.map(n=>({name:n.callFrame.functionName,ms:(times.get(n.id)??0)/1000,source:sources.get(n.callFrame.scriptId)?.[n.callFrame.lineNumber]?.slice(n.callFrame.columnNumber,n.callFrame.columnNumber+160)})).sort((a,b)=>b.ms-a.ms).slice(0,20);
  console.log(JSON.stringify(top,null,2));
  await writeFile(resolve(out,'top.json'),JSON.stringify(top,null,2));
  for(const name of ['cpu6-dense-100','group-pointer-100','resize-25']) {
    const {PNG}=await import('pngjs'); const a=PNG.sync.read(await readFile(resolve('benchmarks/results/baseline',name+'.png'))), z=PNG.sync.read(await readFile(resolve('benchmarks/results/pilot',name+'.png')));let count=0;
    for(let i=0;i<a.data.length;i+=4) if(a.data[i]!==z.data[i]||a.data[i+1]!==z.data[i+1]||a.data[i+2]!==z.data[i+2]) count++;
    console.log(name,'changedPixels',count);
  }
} finally {await b.close();}
