import { GlassButton, GlassCard, GlassLightGroup } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';

export function CardDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();

  return (
    <DemoSection
      index="02"
      title="GlassCard"
      description={t('card.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('card.label')}</span>
          <GlassCard
            className="demo-card"
            cornerRadius={params.cornerRadius}
            {...glassProps(params)}
          >
            <h4 className="demo-card-title">{t('card.title')}</h4>
            <p className="demo-card-text">
              {t('card.body.before')}
              <code>feDisplacementMap</code>
              {t('card.body.mid')}
              <code>scale</code>
              {t('card.body.after')}
            </p>
            <div className="demo-card-actions">
              <GlassLightGroup>
                <GlassButton size="sm" {...glassProps(params)}>
                  {t('card.learn')}
                </GlassButton>
                <GlassButton size="sm" {...glassProps(params)}>
                  {t('card.source')}
                </GlassButton>
              </GlassLightGroup>
            </div>
          </GlassCard>
        </div>
      </div>
    </DemoSection>
  );
}
