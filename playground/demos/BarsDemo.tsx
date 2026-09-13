import { useEffect, useState, type ReactNode } from 'react';
import { GlassButton, GlassLightGroup, GlassSurface, GlassTabBar } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n, type MessageKey } from '../i18n';
import { DemoSection } from './DemoSection';
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
  labelKey: MessageKey;
  icon: ReactNode;
  kind: 'dom' | 'web';
  url?: string;
}

/** 首个源为自写 DOM 信息流（不透明内容可被区域探测；其上的顶/底栏各自绑为识别组，
 *  整组按成员覆盖区域的平均亮度统一翻转，不再逐片乱闪）；其余为公网可嵌入信息流源（响应头已实测）。
 *  被拦截禁用：news.ycombinator.com (XFO DENY) · lite.cnn.com / arxiv.org (frame-ancestors 'none')。
 *  备选池：https://en.m.wikipedia.org/wiki/Wikipedia:Featured_articles */
const FEEDS: FeedSource[] = [
  { key: 'weibo', labelKey: 'bars.feed.weibo', kind: 'dom', icon: <WeiboIcon /> },
  {
    key: 'wiki',
    labelKey: 'bars.feed.wiki',
    kind: 'web',
    url: 'https://en.wikipedia.org/wiki/Portal:Current_events',
    icon: <WikipediaIcon />,
  },
  {
    key: 'solidot',
    labelKey: 'bars.feed.solidot',
    kind: 'web',
    url: 'https://www.solidot.org/',
    icon: <SolidotIcon />,
  },
  { key: 'npr', labelKey: 'bars.feed.npr', kind: 'web', url: 'https://text.npr.org/', icon: <NprIcon /> },
];

function formatClock(date: Date, locale: string) {
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function BarsDemo({ params }: { params: DemoParams }) {
  const { t, locale } = useI18n();
  const [active, setActive] = useState(FEEDS[0].key);
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set([FEEDS[0].key]));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectFeed = (key: string) => {
    setActive(key);
    setLoaded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  const glass = glassProps(params);

  return (
    <DemoSection
      index="03"
      title={t('bars.title')}
      description={t('bars.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('bars.label.device')}</span>
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
                    title={t(feed.labelKey)}
                    style={{ display: feed.key === active ? 'block' : 'none' }}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    referrerPolicy="no-referrer"
                  />
                )
              ) : null,
            )}
            <div className="feed-topbar">
              <GlassLightGroup>
                <GlassButton
                  variant="icon"
                  size="sm"
                  icon={<ChevronLeftIcon />}
                  aria-label={t('common.back')}
                  {...glass}
                />
                <GlassSurface cornerRadius={999} className="feed-clock" {...glass}>
                  <span className="feed-clock-primary">{t('bars.today')}</span>
                  <span className="feed-clock-secondary">{formatClock(now, locale)}</span>
                </GlassSurface>
                <GlassButton
                  variant="icon"
                  size="sm"
                  icon={<EllipsisIcon />}
                  aria-label={t('common.more')}
                  {...glass}
                />
              </GlassLightGroup>
            </div>
            {/* 底部信息源切换：整条底栏（GlassTabBar + 4 个真按钮）绑成一个识别组，
                共享一次区域探测，信息源切换/滚动时整条一起翻明暗，不再逐片乱闪。
                TabBar 仍留最底（label 用 nbsp 占位、不可见），上面各自独立叠 4 个真
                GlassButton（分图层，无包裹容器）：悬停按钮 = 按钮自身滤镜亮度 +0.5，
                点击切源。GlassTabBar 组件零改动。 */}
            <GlassLightGroup>
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
                  aria-label={t('bars.switchTo', { name: t(feed.labelKey) })}
                  onClick={() => selectFeed(feed.key)}
                  {...glass}
                >
                  {t(feed.labelKey)}
                </GlassButton>
              ))}
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
