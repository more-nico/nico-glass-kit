import { useState } from 'react';
import { GlassLightGroup, GlassSegmentedControl, GlassSlider } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';
import { GridIcon, HouseIcon, ListIcon, SearchIcon } from './icons';

const RANGE_ITEMS = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
];

const VIEW_ITEMS = [
  { key: 'list', label: '列表', icon: <ListIcon /> },
  { key: 'grid', label: '网格', icon: <GridIcon /> },
  { key: 'search', label: '搜索', icon: <SearchIcon /> },
];

const TABS = [
  { key: 'home', label: '首页', icon: <HouseIcon /> },
  { key: 'search', label: '搜索', icon: <SearchIcon /> },
];

export function ControlsDemo({ params }: { params: DemoParams }) {
  const [volume, setVolume] = useState(35);
  const [brightness, setBrightness] = useState(72);
  const [range, setRange] = useState('week');
  const [view, setView] = useState('grid');
  const [tab, setTab] = useState('home');

  return (
    <section className="demo-section">
      <header className="demo-head">
        <span className="demo-index">07</span>
        <div className="demo-head-text">
          <h3>GlassSlider & GlassSegmentedControl</h3>
          <p>滑杆用原生 range 玻璃化，分段选择器复用底栏的激活胶囊语言</p>
        </div>
      </header>
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">滑杆 Slider</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassSlider
                className="demo-slider"
                value={volume}
                onChange={setVolume}
                aria-label="音量"
                {...glassProps(params)}
              />
              <GlassSlider
                className="demo-slider demo-slider--sm"
                size="sm"
                value={brightness}
                onChange={setBrightness}
                aria-label="亮度"
                {...glassProps(params)}
              />
              <GlassSlider
                className="demo-slider"
                value={50}
                disabled
                aria-label="禁用滑杆"
                {...glassProps(params)}
              />
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">分段 Segmented</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassSegmentedControl
                items={RANGE_ITEMS}
                value={range}
                onChange={setRange}
                aria-label="时间范围"
                {...glassProps(params)}
              />
              <GlassSegmentedControl
                items={VIEW_ITEMS}
                value={view}
                onChange={setView}
                size="sm"
                aria-label="视图"
                {...glassProps(params)}
              />
              <GlassSegmentedControl
                items={TABS}
                value={tab}
                onChange={setTab}
                aria-label="标签"
                {...glassProps(params)}
              />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </section>
  );
}
