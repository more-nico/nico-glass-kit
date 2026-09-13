import { GlassSegmentedControl } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { glassProps } from '../demos/demoProps';
import { LANGS, useI18n, type Lang } from './index';

export function LanguageSwitcher({ params }: { params: DemoParams }) {
  const { lang, setLang, t } = useI18n();

  return (
    <GlassSegmentedControl
      className="pg-lang"
      size="sm"
      items={LANGS.map((option) => ({
        key: option.id,
        label: <span title={option.name}>{option.short}</span>,
      }))}
      value={lang}
      onChange={(key) => setLang(key as Lang)}
      aria-label={t('nav.language')}
      {...glassProps(params)}
    />
  );
}
