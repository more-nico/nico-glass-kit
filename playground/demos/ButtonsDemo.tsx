import { GlassButton, GlassLightGroup } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';
import { ChevronLeftIcon, EllipsisIcon, PlusIcon } from './icons';

export function ButtonsDemo({ params }: { params: DemoParams }) {
  return (
    <section className="demo-section">
      <header className="demo-head">
        <span className="demo-index">01</span>
        <div className="demo-head-text">
          <h3>GlassButton</h3>
          <p>胶囊按钮与圆形图标按钮，悬停提亮、按压回弹</p>
        </div>
      </header>
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">胶囊 Capsule</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassButton size="sm" {...glassProps(params)}>
                小型
              </GlassButton>
              <GlassButton size="md" {...glassProps(params)}>
                标准胶囊
              </GlassButton>
              <GlassButton size="lg" icon={<PlusIcon />} {...glassProps(params)}>
                大型按钮
              </GlassButton>
              <GlassButton size="md" disabled {...glassProps(params)}>
                禁用
              </GlassButton>
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">图标 Icon</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassButton
                variant="icon"
                size="sm"
                icon={<ChevronLeftIcon />}
                aria-label="返回"
                {...glassProps(params)}
              />
              <GlassButton
                variant="icon"
                size="md"
                icon={<ChevronLeftIcon />}
                aria-label="返回"
                {...glassProps(params)}
              />
              <GlassButton
                variant="icon"
                size="lg"
                icon={<EllipsisIcon />}
                aria-label="更多"
                {...glassProps(params)}
              />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </section>
  );
}
