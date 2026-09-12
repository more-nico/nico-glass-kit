import { useState } from 'react';
import {
  DEFAULT_OPTICS,
  GlassPill,
  GlassProvider,
  type GlassOptics,
  type GlassQuality,
  type OverLight,
} from 'nico-glass-kit';
import { ControlPanel } from './ControlPanel';
import { BackgroundScene, type BackgroundId } from './demos/BackgroundScene';
import { BarsDemo } from './demos/BarsDemo';
import { ButtonsDemo } from './demos/ButtonsDemo';
import { CardDemo } from './demos/CardDemo';
import { HeroDemo } from './demos/HeroDemo';
import { PillDemo } from './demos/PillDemo';
import { BellIcon } from './demos/icons';
import './playground.css';

export interface DemoParams {
  quality: GlassQuality;
  overLight: OverLight;
  optics: GlassOptics;
  highlight: number;
  elasticity: number;
  cornerRadius: number;
  background: BackgroundId | 'custom';
}

const DEFAULT_PARAMS: DemoParams = {
  quality: 'high',
  overLight: 'auto',
  optics: { ...DEFAULT_OPTICS },
  highlight: 1,
  elasticity: 0.15,
  cornerRadius: 32,
  background: 'aurora',
};

export default function App() {
  const [params, setParams] = useState<DemoParams>(DEFAULT_PARAMS);
  const [customBg, setCustomBg] = useState<string | null>(null);
  const [pillVisible, setPillVisible] = useState(false);

  return (
    <GlassProvider quality={params.quality} overLight={params.overLight}>
      <BackgroundScene id={params.background} customUrl={customBg} />

      <header className="pg-header">
        <div className="pg-brand">
          <span className="pg-logo" aria-hidden="true" />
          <span>nico-glass-kit</span>
        </div>
        <span className="pg-badge">Liquid Glass · iOS 26</span>
      </header>

      <main className="pg-main">
        <HeroDemo params={params} onShowPill={() => setPillVisible(true)} />
        <div className="pg-gallery">
          <ButtonsDemo params={params} />
          <CardDemo params={params} />
          <BarsDemo params={params} />
          <PillDemo params={params} onShowPill={() => setPillVisible(true)} />
        </div>
        <footer className="pg-footer">
          nico-glass-kit · Low / Medium / High 三档渲染 · Chromium 折射，
          其余浏览器自动降级
        </footer>
      </main>

      <ControlPanel params={params} onChange={setParams} onUploadBg={setCustomBg} customBg={customBg} />

      <GlassPill
        visible={pillVisible}
        onClose={() => setPillVisible(false)}
        autoHideDuration={4000}
        icon={<BellIcon />}
        primary="昨天 23:07"
        secondary="3 条新消息"
        optics={params.optics}
        highlightIntensity={params.highlight}
        elasticity={0}
      />
    </GlassProvider>
  );
}
