import { GlassButton, GlassLightGroup, GlassPill } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import { BellIcon } from './icons';

interface Props {
  params: DemoParams;
  onShowPill: () => void;
}

export function PillDemo({ params, onShowPill }: Props) {
  const { t } = useI18n();

  return (
    <DemoSection
      index="04"
      title="GlassPill"
      description={t('pill.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('pill.label.inline')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassPill
                icon={<BellIcon />}
                primary={t('app.pill.primary')}
                secondary={t('app.pill.secondary')}
                style={{ position: 'static', animation: 'none' }}
                {...glassProps(params)}
              />
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('pill.label.toast')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassButton size="md" icon={<BellIcon />} onClick={onShowPill} {...glassProps(params)}>
                {t('pill.show')}
              </GlassButton>
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
