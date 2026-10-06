import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { GlassProvider, GlassSurface, GlassText, GlassElasticityGroup, GlassLightGroup, type GlassQuality, type GlassOptics } from '../src/index';
import { lensMapCacheStats } from '../src/core/displacementMap';
import { backdropImageCacheStats, probeBackdropLight } from '../src/core/backdropProbe';
import '../src/tokens.css';
import '../src/core/glass.css';

type Options = { count?: number; quality?: GlassQuality; elasticity?: number; boost?: number; width?: number; radius?: number; optics?: Partial<GlassOptics>; nested?: boolean; text?: boolean; textSize?: number; auto?: boolean; group?: boolean; lightGroup?: boolean };
const root = createRoot(document.getElementById('root')!);
let clicks = 0;
function Fixture(options: Options) {
  const surfaces = <div>{Array.from({length:options.count ?? 3}, (_,i) =>
    <GlassSurface key={i} as="button" data-test={`surface-${i}`} onClick={()=>clicks++}
      elasticity={options.elasticity ?? 0.2} cornerRadius={options.radius ?? 20}
      hoverBrightnessBoost={i===0 ? options.boost ?? 0 : 0} optics={options.optics}
      style={{width:options.width ?? 240,height:100,margin:10}}>{i===0?'Hover me':`Surface ${i}`}</GlassSurface>)}</div>;
  return <GlassProvider quality={options.quality ?? 'high'} overLight={options.auto?'auto':false}>
    <div id="background" style={{position:'fixed',inset:0,backgroundColor:'#202040'}}/>
    {options.lightGroup ? <GlassLightGroup>{surfaces}</GlassLightGroup> : options.group ? <GlassElasticityGroup>{surfaces}</GlassElasticityGroup> : surfaces}
    {options.nested && <GlassProvider quality="high" overLight={false}><GlassSurface data-test="nested" style={{width:240,height:100}}>Nested provider</GlassSurface></GlassProvider>}
    {options.text && <GlassText text="GLASS 2026" fontSize={options.textSize ?? 68} fontFamily="Arial"/>}
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
