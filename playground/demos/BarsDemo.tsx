import { useEffect, useState } from 'react';
import { GlassButton, GlassSurface, GlassTabBar } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from './demoProps';
import { ChevronLeftIcon, EllipsisIcon } from './icons';

interface FeedSource {
  key: string;
  label: string;
  url: string;
}

/** 公网可嵌入信息流源（响应头已实测）。
 *  被拦截禁用：news.ycombinator.com (XFO DENY) · lite.cnn.com / arxiv.org (frame-ancestors 'none')。
 *  备选池：https://en.m.wikipedia.org/wiki/Wikipedia:Featured_articles */
const FEEDS: FeedSource[] = [
  { key: 'hn', label: 'HN', url: 'https://hn.algolia.com/' },
  {
    key: 'wiki',
    label: '维基',
    url: 'https://en.wikipedia.org/wiki/Portal:Current_events',
  },
  { key: 'solidot', label: 'Solidot', url: 'https://www.solidot.org/' },
  { key: 'npr', label: 'NPR', url: 'https://text.npr.org/' },
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
          <p>iOS 26 三件式悬浮玻璃顶栏，内嵌公网页面真实滚动</p>
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
                <iframe
                  key={feed.key}
                  className="phone-iframe"
                  src={feed.url}
                  title={feed.label}
                  style={{ display: feed.key === active ? 'block' : 'none' }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  referrerPolicy="no-referrer"
                />
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
            <GlassTabBar
              items={FEEDS.map(({ key, label }) => ({ key, label }))}
              activeKey={active}
              onChange={selectFeed}
              style={{ position: 'absolute', bottom: 12 }}
              {...glass}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
