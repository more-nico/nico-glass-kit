import { GlassButton, GlassPill } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';
import { BellIcon } from './icons';

interface Props {
  params: DemoParams;
  onShowPill: () => void;
}

export function PillDemo({ params, onShowPill }: Props) {
  return (
    <section className="demo-section">
      <header className="demo-head">
        <span className="demo-index">04</span>
        <div className="demo-head-text">
          <h3>GlassPill</h3>
          <p>悬浮式信息胶囊，可用作 Toast（带进入/退出动画）</p>
        </div>
      </header>
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">内联预览 Inline</span>
          <div className="demo-row">
            <GlassPill
              icon={<BellIcon />}
              primary="昨天 23:07"
              secondary="3 条新消息"
              style={{ position: 'static', animation: 'none' }}
              {...glassProps(params)}
            />
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">浮层 Toast</span>
          <div className="demo-row">
            <GlassButton size="md" icon={<BellIcon />} onClick={onShowPill} {...glassProps(params)}>
              弹出通知（4 秒自动消失）
            </GlassButton>
          </div>
        </div>
      </div>
    </section>
  );
}
