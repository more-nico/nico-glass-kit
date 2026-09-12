import { GlassButton, GlassSurface } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';
import { useDrag } from './useDrag';
import { HeartIcon, PlusIcon, ShareIcon } from './icons';

interface Props {
  params: DemoParams;
  onShowPill: () => void;
}

export function HeroDemo({ params, onShowPill }: Props) {
  const { pos, handlers } = useDrag();

  return (
    <section className="hero">
      <div
        className="hero-capsule"
        style={{
          transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
        }}
        {...handlers}
      >
        <GlassSurface
          className="hero-glass"
          cornerRadius={params.cornerRadius}
          {...glassProps(params)}
        >
          <div className="hero-glass-inner">
            <span className="hero-title">Liquid Glass</span>
            <span className="hero-sub">拖动我 · Drag me · 观察边缘折射与高光</span>
          </div>
        </GlassSurface>
      </div>

      <div className="hero-actions">
        <GlassButton size="lg" icon={<PlusIcon />} {...glassProps(params)}>
          新建
        </GlassButton>
        <GlassButton
          variant="icon"
          size="lg"
          icon={<HeartIcon />}
          aria-label="喜欢"
          {...glassProps(params)}
        />
        <GlassButton
          variant="icon"
          size="lg"
          icon={<ShareIcon />}
          aria-label="分享"
          {...glassProps(params)}
        />
        <GlassButton size="lg" onClick={onShowPill} {...glassProps(params)}>
          显示 Pill
        </GlassButton>
      </div>
    </section>
  );
}
