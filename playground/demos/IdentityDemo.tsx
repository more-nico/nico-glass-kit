import { GlassAvatar, GlassBadge, GlassLightGroup } from 'nico-glass-kit';
import type { DemoParams } from '../App';
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
  return (
    <section className="demo-section">
      <header className="demo-head">
        <span className="demo-index">08</span>
        <div className="demo-head-text">
          <h3>GlassBadge & GlassAvatar</h3>
          <p>状态标签与玻璃头像：色调圆点跟随明暗自适应</p>
        </div>
      </header>
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">标签 Badge</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassBadge dot {...glassProps(params)}>
                已连接
              </GlassBadge>
              <GlassBadge dot tone="info" {...glassProps(params)}>
                同步中
              </GlassBadge>
              <GlassBadge dot tone="success" {...glassProps(params)}>
                已完成
              </GlassBadge>
              <GlassBadge dot tone="warning" {...glassProps(params)}>
                待确认
              </GlassBadge>
              <GlassBadge dot tone="danger" {...glassProps(params)}>
                已过期
              </GlassBadge>
              <GlassBadge size="sm" {...glassProps(params)}>
                12 条未读
              </GlassBadge>
            </GlassLightGroup>
          </div>
        </div>
        <div className="demo-group">
          <span className="demo-label">头像 Avatar</span>
          <div className="demo-row">
            <GlassLightGroup>
              <GlassAvatar size="sm" initials="李" {...glassProps(params)} />
              <GlassAvatar size="md" initials="玻" {...glassProps(params)} />
              <GlassAvatar size="lg" src={AVATAR_IMAGE} alt="示例头像" {...glassProps(params)} />
              <GlassAvatar size={64} src={AVATAR_IMAGE} alt="自定义尺寸头像" {...glassProps(params)} />
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </section>
  );
}
