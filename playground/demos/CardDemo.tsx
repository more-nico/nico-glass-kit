import { GlassButton, GlassCard } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';

export function CardDemo({ params }: { params: DemoParams }) {
  return (
    <section className="demo-section">
      <header className="demo-head">
        <span className="demo-index">02</span>
        <div className="demo-head-text">
          <h3>GlassCard</h3>
          <p>大圆角玻璃卡片，padding 与圆角可调</p>
        </div>
      </header>
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">卡片 Card</span>
          <GlassCard
            className="demo-card"
            cornerRadius={params.cornerRadius}
            {...glassProps(params)}
          >
            <h4 className="demo-card-title">液态玻璃卡片</h4>
            <p className="demo-card-text">
              边缘折射由 Squircle 表面函数与 Snell
              定律实时计算，位移贴图按几何缓存复用；鼠标靠近时只有
              <code>feDisplacementMap</code> 的 <code>scale</code> 参与弹性动画，
              贴图本身不会重建。
            </p>
            <div className="demo-card-actions">
              <GlassButton size="sm" {...glassProps(params)}>
                了解原理
              </GlassButton>
              <GlassButton size="sm" {...glassProps(params)}>
                查看源码
              </GlassButton>
            </div>
          </GlassCard>
        </div>
      </div>
    </section>
  );
}
