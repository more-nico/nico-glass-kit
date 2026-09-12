import { useEffect, useState, type ReactNode } from 'react';
import { GlassButton, GlassSurface, GlassTabBar } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';
import { WeiboFeed } from './WeiboFeed';
import {
  ChevronLeftIcon,
  EllipsisIcon,
  NprIcon,
  SolidotIcon,
  WeiboIcon,
  WikipediaIcon,
} from './icons';

interface FeedSource {
  key: string;
  label: string;
  icon: ReactNode;
  kind: 'dom' | 'web';
  url?: string;
}

/** 首个源为自写 DOM 信息流（不透明内容可被逐元素探测，明暗随帖子内容实时翻转）；
 *  其余为公网可嵌入信息流源（响应头已实测）。
 *  被拦截禁用：news.ycombinator.com (XFO DENY) · lite.cnn.com / arxiv.org (frame-ancestors 'none')。
 *  备选池：https://en.m.wikipedia.org/wiki/Wikipedia:Featured_articles */
const FEEDS: FeedSource[] = [
  { key: 'weibo', label: '微博', kind: 'dom', icon: <WeiboIcon /> },
  {
    key: 'wiki',
    label: '维基',
    kind: 'web',
    url: 'https://en.wikipedia.org/wiki/Portal:Current_events',
    icon: <WikipediaIcon />,
  },
  {
    key: 'solidot',
    label: 'Solidot',
    kind: 'web',
    url: 'https://www.solidot.org/',
    icon: <SolidotIcon />,
  },
  { key: 'npr', label: 'NPR', kind: 'web', url: 'https://text.npr.org/', icon: <NprIcon /> },
];

function formatClock(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function BarsDemo({ params }: { params: DemoParams }) {
  const [active, setActive] = useState(FEEDS[0].key);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set([FEEDS[0].key]));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const selectFeed = (key: string) => {
    setActive(key);
    setLoaded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  const glass = glassProps(params);

  return (
    <section className="demo-section">
      <header className="demo-head">
        <span className="demo-index">03</span>
        <div className="demo-head-text">
          <h3>悬浮顶栏 · 实时信息流</h3>
          <p>iOS 26 三件式悬浮玻璃顶栏，内嵌 DOM 信息流与公网页面真实滚动</p>
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
            {FEEDS.map((feed) =>
              loaded.has(feed.key) ? (
                feed.kind === 'dom' ? (
                  <div
                    key={feed.key}
                    className="phone-page"
                    style={{ display: feed.key === active ? 'block' : 'none' }}
                  >
                    <WeiboFeed />
                  </div>
                ) : (
                  <iframe
                    key={feed.key}
                    className="phone-iframe"
                    src={feed.url}
                    title={feed.label}
                    style={{ display: feed.key === active ? 'block' : 'none' }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    referrerPolicy="no-referrer"
                  />
                )
              ) : null,
            )}
            <div className="feed-topbar">
              <GlassButton
                variant="icon"
                size="sm"
                icon={<ChevronLeftIcon />}
                aria-label="返回"
                {...glass}
              />
              <GlassSurface cornerRadius={999} className="feed-clock" {...glass}>
                <span className="feed-clock-primary">今天</span>
                <span className="feed-clock-secondary">{formatClock(now)}</span>
              </GlassSurface>
              <GlassButton
                variant="icon"
                size="sm"
                icon={<EllipsisIcon />}
                aria-label="更多"
                {...glass}
              />
            </div>
            {/* 底部信息源切换：GlassTabBar 留最底（label 用 nbsp 占位、不可见）；
                上面各自独立叠 4 个真 GlassButton（分图层，无包裹容器），逐片压在
                四颗槽位上：悬停按钮 = 按钮自身滤镜亮度 +0.5，点击切源。
                GlassTabBar 组件零改动。 */}
            <GlassTabBar
              items={FEEDS.map(({ key }) => ({ key, label: '\u00A0' }))}
              activeKey={active}
              onChange={selectFeed}
              style={{ position: 'absolute', bottom: 14 }}
              {...glass}
            />
            {FEEDS.map((feed, i) => (
              <GlassButton
                key={feed.key}
                size="sm"
                className="feed-tab-btn"
                icon={feed.icon}
                style={{ left: `calc(50% - 177.5px + ${i * 90}px)` }}
                aria-pressed={feed.key === active}
                aria-label={`切换到 ${feed.label}`}
                onClick={() => selectFeed(feed.key)}
                {...glass}
              >
                {feed.label}
              </GlassButton>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
