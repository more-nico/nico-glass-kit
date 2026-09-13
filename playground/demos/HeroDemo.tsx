import { GlassButton, GlassLightGroup, GlassSurface } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { glassProps } from './demoProps';
import { useDrag } from './useDrag';
import { HeartIcon, PlusIcon, ShareIcon } from './icons';

interface Props {
  params: DemoParams;
  onShowPill: () => void;
}

export function HeroDemo({ params, onShowPill }: Props) {
  const { t } = useI18n();
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
            <span className="hero-title">Nico Glass</span>
            <span className="hero-sub">{t('hero.drag')}</span>
          </div>
        </GlassSurface>
      </div>

      <div className="hero-actions">
        <GlassLightGroup>
          <GlassButton size="lg" icon={<PlusIcon />} {...glassProps(params)}>
            {t('hero.new')}
          </GlassButton>
          <GlassButton
            variant="icon"
            size="lg"
            icon={<HeartIcon />}
            aria-label={t('hero.like')}
            {...glassProps(params)}
          />
          <GlassButton
            variant="icon"
            size="lg"
            icon={<ShareIcon />}
            aria-label={t('hero.share')}
            {...glassProps(params)}
          />
          <GlassButton size="lg" onClick={onShowPill} {...glassProps(params)}>
            {t('hero.showPill')}
          </GlassButton>
        </GlassLightGroup>
      </div>
    </section>
  );
}
