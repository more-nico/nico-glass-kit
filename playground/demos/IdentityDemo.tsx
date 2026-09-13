import { GlassAvatar, GlassBadge, GlassLightGroup } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';

const AVATAR_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7c3aed"/>
        <stop offset="1" stop-color="#0ea5e9"/>
      </linearGradient>
    </defs>
    <rect width="96" height="96" fill="url(#g)"/>
    <circle cx="48" cy="37" r="15" fill="rgba(255,255,255,0.88)"/>
    <path d="M15 96c4-21 17-31 33-31s29 10 33 31z" fill="rgba(255,255,255,0.88)"/>
  </svg>`,
)}`;

export function IdentityDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();

  return (
    <DemoSection
      index="08"
      title="GlassBadge & GlassAvatar"
      description={t('identity.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('identity.label.badge')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassBadge dot {...glassProps(params)}>
                {t('identity.connected')}
              </GlassBadge>
              <GlassBadge dot tone="info" {...glassProps(params)}>
                {t('identity.syncing')}
              </GlassBadge>
              <GlassBadge dot tone="success" {...glassProps(params)}>
                {t('identity.done')}
              </GlassBadge>
              <GlassBadge dot tone="warning" {...glassProps(params)}>
                {t('identity.pending')}
              </GlassBadge>
              <GlassBadge dot tone="danger" {...glassProps(params)}>
                {t('identity.expired')}
              </GlassBadge>
              <GlassBadge size="sm" {...glassProps(params)}>
                {t('identity.unread')}
              </GlassBadge>
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('identity.label.avatar')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassAvatar size="sm" initials={t('identity.initials.sm')} {...glassProps(params)} />
              <GlassAvatar size="md" initials={t('identity.initials.md')} {...glassProps(params)} />
              <GlassAvatar
                size="lg"
                src={AVATAR_IMAGE}
                alt={t('identity.alt.avatar')}
                {...glassProps(params)}
              />
              <GlassAvatar
                size={64}
                src={AVATAR_IMAGE}
                alt={t('identity.alt.custom')}
                {...glassProps(params)}
              />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
