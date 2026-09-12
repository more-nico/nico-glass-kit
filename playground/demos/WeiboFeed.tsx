import { SearchIcon } from './icons';

export function WeiboFeed() {
  return (
    <div className="mini-weibo">
      <header className="mw-topbar">
        <span className="mw-logo">微博</span>
        <div className="mw-search">
          <SearchIcon />
          <span>大家正在搜：城市夜航手记</span>
        </div>
      </header>

      <article className="mw-post">
        <div className="mw-avatar mw-avatar--night">🌙</div>
        <div className="mw-main">
          <div className="mw-meta">
            <span className="mw-name">城市夜航手记</span>
            <span className="mw-v">V</span>
            <span className="mw-time">今天 02:14 · 来自 iPhone</span>
          </div>
          <p className="mw-text">
            凌晨两点半的环城高架只剩路灯和偶尔掠过的出租车，
            <span className="mw-topic">#城市夜航#</span>
            把镜头伸出车窗，风比照片更冷。
          </p>
          <div className="mw-pic mw-pic--night">
            <span className="mw-stars" />
            <span className="mw-moon" />
            <span className="mw-city" />
            <span className="mw-pic-caption">NIGHT FLIGHT · 02:14</span>
          </div>
          <div className="mw-actions">
            <span>转发 128</span>
            <span>评论 206</span>
            <span>赞 1.2万</span>
          </div>
        </div>
      </article>

      <section className="mw-hot">
        <header className="mw-hot-head">
          <span className="mw-hot-flame">🔥</span>
          <span>微博热搜</span>
          <span className="mw-hot-more">更多</span>
        </header>
        <ol className="mw-hot-list">
          <li>
            <span className="mw-rank mw-rank--1">1</span>
            <span className="mw-hot-word">城市夜航手记</span>
            <span className="mw-hot-heat">324.5万</span>
          </li>
          <li>
            <span className="mw-rank mw-rank--2">2</span>
            <span className="mw-hot-word">高架上的月亮</span>
            <span className="mw-hot-heat">218.7万</span>
          </li>
          <li>
            <span className="mw-rank mw-rank--3">3</span>
            <span className="mw-hot-word">凌晨两点的出租车</span>
            <span className="mw-hot-heat">176.2万</span>
          </li>
          <li>
            <span className="mw-rank">4</span>
            <span className="mw-hot-word">深夜电波下播</span>
            <span className="mw-hot-heat">98.4万</span>
          </li>
          <li>
            <span className="mw-rank">5</span>
            <span className="mw-hot-word">一个人住的第三年</span>
            <span className="mw-hot-heat">73.1万</span>
          </li>
        </ol>
      </section>

      <article className="mw-post">
        <div className="mw-avatar mw-avatar--dawn">📻</div>
        <div className="mw-main">
          <div className="mw-meta">
            <span className="mw-name">深夜电波 FM</span>
            <span className="mw-v">V</span>
            <span className="mw-time">今天 04:30 · 来自直播间</span>
          </div>
          <p className="mw-text">
            下播前的最后十分钟，天边已经开始泛白。今晚聊了
            <span className="mw-topic">#一个人住的第三年#</span>
            ，谢谢还在线的七千位朋友，明晚同一时间见。
          </p>
          <div className="mw-pic mw-pic--dawn">
            <span className="mw-sun" />
            <span className="mw-pic-caption">05:52 · 第一缕光</span>
          </div>
          <div className="mw-actions">
            <span>转发 342</span>
            <span>评论 518</span>
            <span>赞 2.8万</span>
          </div>
        </div>
      </article>

      <article className="mw-post">
        <div className="mw-avatar mw-avatar--text">✍️</div>
        <div className="mw-main">
          <div className="mw-meta">
            <span className="mw-name">凌晨四点半</span>
            <span className="mw-v">V</span>
            <span className="mw-time">今天 04:36 · 来自 微博网页版</span>
          </div>
          <p className="mw-text">
            夜里写稿的人大概都懂：白天攒下的所有句子，要等到整座城市安静下来才肯排队出现。
            楼下便利店的灯是这条街上最后熄的一盏，店员在补货，关东煮冒着白气。
            我买一杯热豆浆，站在门口看天从墨蓝变成灰蓝，再变成淡淡的橘。
            那一刻会觉得，熬夜也不算完全的坏事。
          </p>
          <div className="mw-actions">
            <span>转发 56</span>
            <span>评论 89</span>
            <span>赞 6042</span>
          </div>
        </div>
      </article>

      <article className="mw-post">
        <div className="mw-avatar mw-avatar--sunset">🌇</div>
        <div className="mw-main">
          <div className="mw-meta">
            <span className="mw-name">落日收藏家</span>
            <span className="mw-v">V</span>
            <span className="mw-time">今天 18:47 · 来自 微博视频号</span>
          </div>
          <p className="mw-text">
            今天下班路上遇到的火烧云，手机直出，一点滤镜都没加。
            <span className="mw-topic">#今日晚霞#</span>
          </p>
          <div className="mw-pic mw-pic--sunset">
            <span className="mw-sun mw-sun--low" />
            <span className="mw-pic-caption">18:47 · 西三环</span>
          </div>
          <div className="mw-actions">
            <span>转发 91</span>
            <span>评论 143</span>
            <span>赞 8735</span>
          </div>
        </div>
      </article>

      <footer className="mw-end">
        <span>已经到底啦</span>
      </footer>
    </div>
  );
}
