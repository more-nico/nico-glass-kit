import { useI18n } from '../i18n';
import { SearchIcon } from './icons';

export function WeiboFeed() {
  const { t } = useI18n();

  return (
    <div className="mini-weibo">
      <header className="mw-topbar">
        <span className="mw-logo">{t('feed.logo')}</span>
        <div className="mw-search">
          <SearchIcon />
          <span>{t('feed.search')}</span>
        </div>
      </header>

      <article className="mw-post">
        <div className="mw-avatar mw-avatar--night">🌙</div>
        <div className="mw-main">
          <div className="mw-meta">
            <span className="mw-name">{t('feed.post1.name')}</span>
            <span className="mw-v">V</span>
            <span className="mw-time">{t('feed.post1.time')}</span>
          </div>
          <p className="mw-text">
            {t('feed.post1.body.before')}
            <span className="mw-topic">{t('feed.post1.topic')}</span>
            {t('feed.post1.body.after')}
          </p>
          <div className="mw-pic mw-pic--night">
            <span className="mw-stars" />
            <span className="mw-moon" />
            <span className="mw-city" />
            <span className="mw-pic-caption">{t('feed.post1.caption')}</span>
          </div>
          <div className="mw-actions">
            <span>
              {t('feed.forward')} {t('feed.post1.forward')}
            </span>
            <span>
              {t('feed.comment')} {t('feed.post1.comment')}
            </span>
            <span>
              {t('feed.like')} {t('feed.post1.like')}
            </span>
          </div>
        </div>
      </article>

      <section className="mw-hot">
        <header className="mw-hot-head">
          <span className="mw-hot-flame">🔥</span>
          <span>{t('feed.hot.title')}</span>
          <span className="mw-hot-more">{t('feed.hot.more')}</span>
        </header>
        <ol className="mw-hot-list">
          <li>
            <span className="mw-rank mw-rank--1">1</span>
            <span className="mw-hot-word">{t('feed.hot.1.word')}</span>
            <span className="mw-hot-heat">{t('feed.hot.1.heat')}</span>
          </li>
          <li>
            <span className="mw-rank mw-rank--2">2</span>
            <span className="mw-hot-word">{t('feed.hot.2.word')}</span>
            <span className="mw-hot-heat">{t('feed.hot.2.heat')}</span>
          </li>
          <li>
            <span className="mw-rank mw-rank--3">3</span>
            <span className="mw-hot-word">{t('feed.hot.3.word')}</span>
            <span className="mw-hot-heat">{t('feed.hot.3.heat')}</span>
          </li>
          <li>
            <span className="mw-rank">4</span>
            <span className="mw-hot-word">{t('feed.hot.4.word')}</span>
            <span className="mw-hot-heat">{t('feed.hot.4.heat')}</span>
          </li>
          <li>
            <span className="mw-rank">5</span>
            <span className="mw-hot-word">{t('feed.hot.5.word')}</span>
            <span className="mw-hot-heat">{t('feed.hot.5.heat')}</span>
          </li>
        </ol>
      </section>

      <article className="mw-post">
        <div className="mw-avatar mw-avatar--dawn">📻</div>
        <div className="mw-main">
          <div className="mw-meta">
            <span className="mw-name">{t('feed.post2.name')}</span>
            <span className="mw-v">V</span>
            <span className="mw-time">{t('feed.post2.time')}</span>
          </div>
          <p className="mw-text">
            {t('feed.post2.body.before')}
            <span className="mw-topic">{t('feed.post2.topic')}</span>
            {t('feed.post2.body.after')}
          </p>
          <div className="mw-pic mw-pic--dawn">
            <span className="mw-sun" />
            <span className="mw-pic-caption">{t('feed.post2.caption')}</span>
          </div>
          <div className="mw-actions">
            <span>
              {t('feed.forward')} {t('feed.post2.forward')}
            </span>
            <span>
              {t('feed.comment')} {t('feed.post2.comment')}
            </span>
            <span>
              {t('feed.like')} {t('feed.post2.like')}
            </span>
          </div>
        </div>
      </article>

      <article className="mw-post">
        <div className="mw-avatar mw-avatar--text">✍️</div>
        <div className="mw-main">
          <div className="mw-meta">
            <span className="mw-name">{t('feed.post3.name')}</span>
            <span className="mw-v">V</span>
            <span className="mw-time">{t('feed.post3.time')}</span>
          </div>
          <p className="mw-text">{t('feed.post3.body')}</p>
          <div className="mw-actions">
            <span>
              {t('feed.forward')} {t('feed.post3.forward')}
            </span>
            <span>
              {t('feed.comment')} {t('feed.post3.comment')}
            </span>
            <span>
              {t('feed.like')} {t('feed.post3.like')}
            </span>
          </div>
        </div>
      </article>

      <article className="mw-post">
        <div className="mw-avatar mw-avatar--sunset">🌇</div>
        <div className="mw-main">
          <div className="mw-meta">
            <span className="mw-name">{t('feed.post4.name')}</span>
            <span className="mw-v">V</span>
            <span className="mw-time">{t('feed.post4.time')}</span>
          </div>
          <p className="mw-text">
            {t('feed.post4.body.before')}
            <span className="mw-topic">{t('feed.post4.topic')}</span>
            {t('feed.post4.body.after')}
          </p>
          <div className="mw-pic mw-pic--sunset">
            <span className="mw-sun mw-sun--low" />
            <span className="mw-pic-caption">{t('feed.post4.caption')}</span>
          </div>
          <div className="mw-actions">
            <span>
              {t('feed.forward')} {t('feed.post4.forward')}
            </span>
            <span>
              {t('feed.comment')} {t('feed.post4.comment')}
            </span>
            <span>
              {t('feed.like')} {t('feed.post4.like')}
            </span>
          </div>
        </div>
      </article>

      <footer className="mw-end">
        <span>{t('feed.end')}</span>
      </footer>
    </div>
  );
}
