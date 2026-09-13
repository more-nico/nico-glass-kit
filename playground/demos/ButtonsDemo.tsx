import { GlassButton, GlassLightGroup } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import { ChevronLeftIcon, EllipsisIcon, PlusIcon } from './icons';

export function ButtonsDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();

  return (
    <DemoSection
      index="01"
      title="GlassButton"
      description={t('buttons.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('buttons.label.capsule')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassButton size="sm" {...glassProps(params)}>
                {t('buttons.sm')}
              </GlassButton>
              <GlassButton size="md" {...glassProps(params)}>
                {t('buttons.md')}
              </GlassButton>
              <GlassButton size="lg" icon={<PlusIcon />} {...glassProps(params)}>
                {t('buttons.lg')}
              </GlassButton>
              <GlassButton size="md" disabled {...glassProps(params)}>
                {t('buttons.disabled')}
              </GlassButton>
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('buttons.label.icon')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassButton
                variant="icon"
                size="sm"
                icon={<ChevronLeftIcon />}
                aria-label={t('common.back')}
                {...glassProps(params)}
              />
              <GlassButton
                variant="icon"
                size="md"
                icon={<ChevronLeftIcon />}
                aria-label={t('common.back')}
                {...glassProps(params)}
              />
              <GlassButton
                variant="icon"
                size="lg"
                icon={<EllipsisIcon />}
                aria-label={t('common.more')}
                {...glassProps(params)}
              />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
