import { useState } from 'react';
import { GlassInput, GlassLightGroup, GlassSelect } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import { CloseIcon, InfoIcon, SearchIcon } from './icons';

export function InputsDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(() => t('inputs.query'));
  const [kind, setKind] = useState('photo');
  const [size, setSize] = useState('md');

  const kindItems = [
    { key: 'photo', label: t('inputs.kind.photo') },
    { key: 'video', label: t('inputs.kind.video') },
    { key: 'audio', label: t('inputs.kind.audio') },
    { key: 'live', label: t('inputs.kind.live'), disabled: true },
  ];

  const sizeItems = [
    { key: 'sm', label: t('inputs.size.sm') },
    { key: 'md', label: t('inputs.size.md') },
    { key: 'lg', label: t('inputs.size.lg') },
  ];

  return (
    <DemoSection
      index="05"
      title="GlassInput & GlassSelect"
      description={t('inputs.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('inputs.label.size')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassInput
                className="demo-field"
                size="sm"
                placeholder={t('inputs.placeholder.sm')}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassInput
                className="demo-field"
                size="md"
                leading={<SearchIcon />}
                placeholder={t('inputs.placeholder.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassInput
                className="demo-field"
                size="lg"
                placeholder={t('inputs.placeholder.lg')}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('inputs.label.state')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassInput
                className="demo-field"
                invalid
                defaultValue={t('inputs.invalid')}
                leading={<InfoIcon />}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassInput
                className="demo-field"
                disabled
                placeholder={t('inputs.placeholder.disabled')}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassInput
                className="demo-field"
                placeholder={t('inputs.placeholder.clearable')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                trailing={
                  query ? (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label={t('inputs.aria.clear')}
                    >
                      <CloseIcon />
                    </button>
                  ) : undefined
                }
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('inputs.label.select')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassSelect
                className="demo-field"
                items={kindItems}
                value={kind}
                onChange={setKind}
                aria-label={t('inputs.aria.kind')}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassSelect
                className="demo-field"
                size="sm"
                items={sizeItems}
                value={size}
                onChange={setSize}
                aria-label={t('inputs.aria.size')}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassSelect
                className="demo-field"
                items={sizeItems}
                placeholder={t('inputs.placeholder.selectDisabled')}
                disabled
                aria-label={t('inputs.aria.disabled')}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <GlassSelect
                className="demo-field"
                size="lg"
                items={sizeItems}
                value={size}
                onChange={setSize}
                aria-label={t('inputs.aria.sizeLg')}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
