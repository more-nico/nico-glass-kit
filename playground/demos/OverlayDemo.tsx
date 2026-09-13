import { useState } from 'react';
import { GlassAlert, GlassButton, GlassLightGroup, GlassModal, GlassTooltip } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import { DownloadIcon, InfoIcon, PlusIcon } from './icons';

export function OverlayDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(true);

  return (
    <DemoSection
      index="10"
      title="GlassAlert & GlassTooltip & GlassModal"
      description={t('overlay.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('overlay.label.alert')}</span>
          <div className="demo-column">
            <GlassAlert
              className="demo-alert"
              tone="info"
              title={t('overlay.update.title')}
              {...glassProps(params)}
              cornerRadius={params.cornerRadius}
            >
              {t('overlay.update.body')}
            </GlassAlert>
            <GlassAlert
              className="demo-alert"
              tone="success"
              title={t('overlay.synced.title')}
              {...glassProps(params)}
              cornerRadius={params.cornerRadius}
            >
              {t('overlay.synced.body')}
            </GlassAlert>
            <GlassAlert
              className="demo-alert"
              tone="danger"
              title={t('overlay.expired.title')}
              {...glassProps(params)}
              cornerRadius={params.cornerRadius}
            >
              {t('overlay.expired.body')}
            </GlassAlert>
            {alertOpen ? (
              <GlassAlert
                className="demo-alert"
                tone="warning"
                title={t('overlay.storage.title')}
                onClose={() => setAlertOpen(false)}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              >
                {t('overlay.storage.body')}
              </GlassAlert>
            ) : (
              <div className="demo-row">
                <GlassLightGroup>
                  <GlassButton size="sm" onClick={() => setAlertOpen(true)} {...glassProps(params)}>
                    {t('overlay.restore')}
                  </GlassButton>
                </GlassLightGroup>
              </div>
            )}
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('overlay.label.tooltip')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassTooltip content={t('overlay.tooltip.top')} placement="top" {...glassProps(params)}>
                <GlassButton size="sm" {...glassProps(params)}>
                  {t('overlay.up')}
                </GlassButton>
              </GlassTooltip>
              <GlassTooltip
                content={t('overlay.tooltip.bottom')}
                placement="bottom"
                {...glassProps(params)}
              >
                <GlassButton size="sm" icon={<InfoIcon />} {...glassProps(params)}>
                  {t('overlay.down')}
                </GlassButton>
              </GlassTooltip>
              <GlassTooltip content={t('overlay.tooltip.left')} placement="left" {...glassProps(params)}>
                <GlassButton
                  size="sm"
                  variant="icon"
                  icon={<DownloadIcon />}
                  aria-label={t('overlay.download')}
                  {...glassProps(params)}
                />
              </GlassTooltip>
              <GlassTooltip
                content={t('overlay.tooltip.right')}
                placement="right"
                {...glassProps(params)}
              >
                <GlassButton size="sm" icon={<PlusIcon />} {...glassProps(params)}>
                  {t('overlay.right')}
                </GlassButton>
              </GlassTooltip>
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('overlay.label.modal')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassButton onClick={() => setModalOpen(true)} {...glassProps(params)}>
                {t('overlay.open')}
              </GlassButton>
            </GlassLightGroup>
          </div>
        </div>
      </div>

      <GlassModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={t('overlay.modal.title')}
        footer={
          <GlassLightGroup>
            <GlassButton size="sm" onClick={() => setModalOpen(false)} {...glassProps(params)}>
              {t('overlay.modal.cancel')}
            </GlassButton>
            <GlassButton size="sm" onClick={() => setModalOpen(false)} {...glassProps(params)}>
              {t('overlay.modal.create')}
            </GlassButton>
          </GlassLightGroup>
        }
        {...glassProps(params)}
        cornerRadius={params.cornerRadius}
      >
        {t('overlay.modal.body')}
      </GlassModal>
    </DemoSection>
  );
}
