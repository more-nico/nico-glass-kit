import { GlassLightGroup, GlassProgress, GlassSpinner } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';

export function ProgressDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();

  return (
    <DemoSection
      index="09"
      title="GlassProgress & GlassSpinner"
      description={t('progress.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('progress.label.progress')}</span>
          <div className="demo-column">
            <GlassProgress
              className="demo-progress"
              value={0.28}
              label={t('progress.upload')}
              {...glassProps(params)}
            />
            <GlassProgress
              className="demo-progress"
              size="sm"
              value={0.65}
              label={t('progress.sync')}
              {...glassProps(params)}
            />
            <GlassProgress
              className="demo-progress"
              size="lg"
              value={1}
              label={t('progress.complete')}
              {...glassProps(params)}
            />
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('progress.label.spinner')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassSpinner size="sm" label={t('progress.loadingSm')} {...glassProps(params)} />
              <GlassSpinner label={t('progress.loading')} {...glassProps(params)} />
              <GlassSpinner size="lg" label={t('progress.loadingLg')} {...glassProps(params)} />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
