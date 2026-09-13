import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { zh, type MessageKey } from './zh';
import { en } from './en';
import { ru } from './ru';
import { ja } from './ja';
import { ko } from './ko';

export type { MessageKey };

export type Lang = 'zh' | 'en' | 'ru' | 'ja' | 'ko';

export interface LangOption {
  id: Lang;
  short: string;
  name: string;
  tag: string;
}

export const LANGS: LangOption[] = [
  { id: 'zh', short: 'ZH', name: '中文', tag: 'zh-CN' },
  { id: 'en', short: 'EN', name: 'English', tag: 'en-US' },
  { id: 'ru', short: 'RU', name: 'Русский', tag: 'ru-RU' },
  { id: 'ja', short: 'JA', name: '日本語', tag: 'ja-JP' },
  { id: 'ko', short: 'KO', name: '한국어', tag: 'ko-KR' },
];

const MESSAGES: Record<Lang, Record<MessageKey, string>> = { zh, en, ru, ja, ko };

const STORAGE_KEY = 'nico-glass-kit:lang';

function isLang(value: string | null): value is Lang {
  return value !== null && value in MESSAGES;
}

function detectLang(): Lang {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isLang(saved)) return saved;
    } catch {
      // localStorage can be blocked; fall through to the browser language.
    }
    const base = window.navigator.language?.toLowerCase() ?? '';
    if (base.startsWith('zh')) return 'zh';
    if (base.startsWith('ru')) return 'ru';
    if (base.startsWith('ja')) return 'ja';
    if (base.startsWith('ko')) return 'ko';
    if (base.startsWith('en')) return 'en';
  }
  return 'en';
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export interface I18nValue {
  lang: Lang;
  locale: string;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage can be blocked; the session still switches.
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) =>
      interpolate(MESSAGES[lang][key], vars),
    [lang],
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const tag = LANGS.find((option) => option.id === lang)?.tag ?? 'en-US';
    document.documentElement.lang = tag;
    document.title = MESSAGES[lang]['app.documentTitle'];
  }, [lang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      locale: LANGS.find((option) => option.id === lang)?.tag ?? 'en-US',
      setLang,
      t,
    }),
    [lang, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
