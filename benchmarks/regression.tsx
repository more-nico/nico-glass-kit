import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { GlassProvider, GlassSurface, GlassText, GlassElasticityGroup, GlassLightGroup, GlassRenderGroup, type GlassQuality, type GlassOptics } from '../src/index';
import { lensMapCacheStats } from '../src/core/displacementMap';
import { backdropImageCacheStats, probeBackdropLight } from '../src/core/backdropProbe';
import '../src/tokens.css';
import '../src/core/glass.css';

export type Options = { count?: number; quality?: GlassQuality; elasticity?: number; boost?: number; width?: number; radius?: number; optics?: Partial<GlassOptics>; nested?: boolean; text?: boolean; textSize?: number; textOffset?: number; auto?: boolean; group?: boolean; lightGroup?: boolean; renderGroup?: boolean; nestedRenderGroup?: boolean; batchEnabled?: boolean };
const root = createRoot(document.getElementById('root')!);
let clicks = 0;
function Fixture(options: Options) {
  const surfaces = <div>{Array.from({length:options.count ?? 3}, (_,i) =>
    <GlassSurface key={i} as="button" data-test={`surface-${i}`} onClick={()=>clicks++}
      elasticity={options.elasticity ?? 0.2} cornerRadius={options.radius ?? 20}
      hoverBrightnessBoost={i===0 ? options.boost ?? 0 : 0} optics={options.optics}
      style={{width:options.width ?? 240,height:100,margin:10,...(options.renderGroup ? {border:0,padding:0,background:'transparent'} : {})}}>{i===0?'Hover me':`Surface ${i}`}</GlassSurface>)}</div>;
  return <GlassProvider quality={options.quality ?? 'high'} overLight={options.auto?'auto':false}>
    <div id="background" style={{position:'fixed',inset:0,backgroundColor:'#202040'}}/>
    {options.renderGroup ? <GlassRenderGroup data-test="outer-render-group" enabled={options.batchEnabled}>{surfaces}
      {options.nestedRenderGroup && <GlassRenderGroup data-test="inner-render-group" style={{marginTop:80}}>
        {[0,1,2].map(i => <GlassSurface key={i} as="button" data-test={`inner-${i}`} elasticity={0.25} hoverBrightnessBoost={0.2}
          style={{width:240,height:100,margin:10,border:0,padding:0,background:'transparent'}}>Inner {i}</GlassSurface>)}
      </GlassRenderGroup>}
    </GlassRenderGroup> : options.lightGroup ? <GlassLightGroup>{surfaces}</GlassLightGroup> : options.group ? <GlassElasticityGroup>{surfaces}</GlassElasticityGroup> : surfaces}
    {options.nested && <GlassProvider quality="high" overLight={false}><GlassSurface data-test="nested" style={{width:240,height:100}}>Nested provider</GlassSurface></GlassProvider>}
    {options.text && <GlassText text="GLASS 2026" fontSize={options.textSize ?? 68} fontFamily="Arial" style={{marginTop:options.textOffset ?? 0}}/>}
  </GlassProvider>;
}
const api = {
  render(options: Options = {}) { flushSync(()=>root.render(<StrictMode><Fixture {...options}/></StrictMode>)); },
  unmount() { flushSync(()=>root.render(null)); },
  stats() { return { cache:lensMapCacheStats(),images:backdropImageCacheStats(),filters:document.querySelectorAll('filter').length, clicks }; },
  probeBackground() { return probeBackdropLight(document.querySelector('[data-test="surface-0"]')!); },
};
api.render();
(window as unknown as {glassTest:typeof api}).glassTest = api;

export type GlassTestApi = typeof api;
