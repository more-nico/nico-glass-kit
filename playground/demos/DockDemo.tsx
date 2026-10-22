import { useState, type KeyboardEvent } from 'react';
import { GlassButton, GlassSurface } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import { GridIcon, HeartIcon, HouseIcon, ListIcon, PlusIcon, SolidotIcon, SunIcon } from './icons';
import './DockDemo.css';

const PAGES = [
  { key: 'home', label: 'dock.page.home', Icon: HouseIcon },
  { key: 'work', label: 'dock.page.work', Icon: GridIcon },
  { key: 'design', label: 'dock.page.design', Icon: SunIcon },
  { key: 'reading', label: 'dock.page.reading', Icon: ListIcon },
  { key: 'development', label: 'dock.page.development', Icon: SolidotIcon },
  { key: 'life', label: 'dock.page.life', Icon: HeartIcon },
] as const;
const MAX_EXTRA_PAGES = 6;

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next].focus();
}

export function DockDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();
  const [active, setActive] = useState('home');
  const [extraPages, setExtraPages] = useState(0);
  const pages = [
    ...PAGES.map(page => ({ key: page.key as string, label: t(page.label), Icon: page.Icon })),
    ...Array.from({ length: extraPages }, (_, i) => ({
      key: `extra-${i + 1}`, label: t('dock.page.extra', { number: i + 1 }), Icon: GridIcon,
    })),
  ];

  const addPage = () => {
    if (extraPages >= MAX_EXTRA_PAGES) return;
    setExtraPages(extraPages + 1);
    setActive(`extra-${extraPages + 1}`);
  };

  return (
    <div id="dock-demo">
      <DemoSection index="12" title="GlassSurface · Dock" description={t('dock.description')} params={params}>
        <div className="demo-dock-stage">
          <GlassSurface as="nav" className="demo-dock" cornerRadius={26} aria-label={t('dock.aria')} {...glassProps(params)}>
            <div className="demo-dock-inner" onKeyDown={moveFocus}>
              {pages.map(({ key, label, Icon }) => (
                <button key={key} type="button" className="demo-dock-page" aria-label={label}
                  aria-pressed={active === key} onClick={() => setActive(key)}>
                  <span className="demo-dock-icon"><Icon /></span>
                  <span className="demo-dock-label" aria-hidden="true">{label}</span>
                </button>
              ))}
              <span className="demo-dock-divider" aria-hidden="true" />
              <button type="button" className="demo-dock-page demo-dock-add" aria-label={t('dock.add')}
                disabled={extraPages >= MAX_EXTRA_PAGES} onClick={addPage}>
                <span className="demo-dock-icon"><PlusIcon /></span>
                <span className="demo-dock-label" aria-hidden="true">{t('dock.add')}</span>
              </button>
            </div>
          </GlassSurface>
        </div>
        <div className="demo-dock-footer">
          <output className="demo-dock-current" aria-live="polite">
            {t('dock.current', { name: pages.find(page => page.key === active)!.label })}
          </output>
          <GlassButton size="sm" disabled={extraPages === 0 && active === 'home'}
            onClick={() => { setExtraPages(0); setActive('home'); }} {...glassProps(params)}>
            {t('dock.reset')}
          </GlassButton>
        </div>
        <p className="demo-dock-hint">{t('dock.hint')}</p>
      </DemoSection>
    </div>
  );
}
