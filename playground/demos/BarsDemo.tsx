import { useState } from 'react';
import { GlassButton, GlassNavBar, GlassTabBar } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';
import { ChevronLeftIcon, EllipsisIcon, GearIcon, HouseIcon, SearchIcon } from './icons';

const TAB_ITEMS = [
  { key: 'home', icon: <HouseIcon />, label: '首页' },
  { key: 'search', icon: <SearchIcon />, label: '搜索' },
  { key: 'settings', icon: <GearIcon />, label: '设置' },
];

export function BarsDemo({ params }: { params: DemoParams }) {
  const [active, setActive] = useState('home');

  return (
    <section className="demo-section">
      <header className="demo-head">
        <span className="demo-index">03</span>
        <div className="demo-head-text">
          <h3>GlassNavBar · GlassTabBar</h3>
          <p>iOS 26 悬浮式导航与标签栏（嵌入设备框演示）</p>
        </div>
      </header>
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">设备框 Device</span>
          <div className="phone-frame">
            <div className="phone-bg">
              <div className="blob blob-1" />
              <div className="blob blob-2" />
            </div>
            <div className="phone-content">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="phone-row" />
              ))}
            </div>
            <GlassNavBar
              title="消息"
              style={{ position: 'absolute', top: 12, left: 12, right: 12 }}
              leading={
                <GlassButton
                  variant="icon"
                  size="sm"
                  icon={<ChevronLeftIcon />}
                  aria-label="返回"
                  {...glassProps(params)}
                />
              }
              trailing={
                <GlassButton
                  variant="icon"
                  size="sm"
                  icon={<EllipsisIcon />}
                  aria-label="更多"
                  {...glassProps(params)}
                />
              }
              {...glassProps(params)}
            />
            <GlassTabBar
              items={TAB_ITEMS}
              activeKey={active}
              onChange={setActive}
              style={{ position: 'absolute', bottom: 12 }}
              {...glassProps(params)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
