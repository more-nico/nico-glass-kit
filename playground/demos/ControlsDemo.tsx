import { useState } from 'react';
import { GlassLightGroup, GlassSegmentedControl, GlassSlider } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import { GridIcon, HouseIcon, ListIcon, SearchIcon } from './icons';

export function ControlsDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();
  const [volume, setVolume] = useState(35);
  const [brightness, setBrightness] = useState(72);
  const [range, setRange] = useState('week');
  const [view, setView] = useState('grid');
  const [tab, setTab] = useState('home');

  const rangeItems = [
    { key: 'day', label: t('controls.range.day') },
    { key: 'week', label: t('controls.range.week') },
    { key: 'month', label: t('controls.range.month') },
  ];

  const viewItems = [
    { key: 'list', label: t('controls.view.list'), icon: <ListIcon /> },
    { key: 'grid', label: t('controls.view.grid'), icon: <GridIcon /> },
    { key: 'search', label: t('controls.view.search'), icon: <SearchIcon /> },
  ];

  const tabItems = [
    { key: 'home', label: t('controls.tab.home'), icon: <HouseIcon /> },
    { key: 'search', label: t('controls.tab.search'), icon: <SearchIcon /> },
  ];

  return (
    <DemoSection
      index="07"
      title="GlassSlider & GlassSegmentedControl"
      description={t('controls.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('controls.label.slider')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassSlider
                className="demo-slider"
                value={volume}
                onChange={setVolume}
                aria-label={t('controls.aria.volume')}
                {...glassProps(params)}
              />
              <GlassSlider
                className="demo-slider demo-slider--sm"
                size="sm"
                value={brightness}
                onChange={setBrightness}
                aria-label={t('controls.aria.brightness')}
                {...glassProps(params)}
              />
              <GlassSlider
                className="demo-slider"
                value={50}
                disabled
                aria-label={t('controls.aria.disabled')}
                {...glassProps(params)}
              />
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">{t('controls.label.segmented')}</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassSegmentedControl
                items={rangeItems}
                value={range}
                onChange={setRange}
                aria-label={t('controls.aria.range')}
                {...glassProps(params)}
              />
              <GlassSegmentedControl
                items={viewItems}
                value={view}
                onChange={setView}
                size="sm"
                aria-label={t('controls.aria.view')}
                {...glassProps(params)}
              />
              <GlassSegmentedControl
                items={tabItems}
                value={tab}
                onChange={setTab}
                aria-label={t('controls.aria.tabs')}
                {...glassProps(params)}
              />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
