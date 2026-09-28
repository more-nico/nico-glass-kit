import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  GlassButton,
  GlassElasticityGroup,
  GlassInput,
  GlassLightGroup,
  GlassText,
} from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import './TextDemo.css';

const MIN_SIZE = 56;
const MAX_SIZE = 208;
const SIZE_PRESETS = [72, 132, 192];
const DRAG_SCALE = 0.7;
const LARGE_TEXT_SIZE = 192;
const TEXT_FONT_FAMILY = '"Segoe UI Variable", "Segoe UI", sans-serif';
const LETTER_FONT_FAMILY = '"Palatino Linotype", serif';
const CHINESE_FONT_FAMILY = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", serif';
const JAPANESE_FONT_FAMILY = '"Noto Serif JP", "Yu Mincho", "Noto Serif SC", serif';

/** The preview field accepts at most this many characters. */
const MAX_CHARS = 10;

type SegmenterConstructor = new (
  locales: undefined,
  options: { granularity: 'grapheme' },
) => { segment: (value: string) => Iterable<{ segment: string }> };
const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
const characterSegmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;

function characters(value: string): string[] {
  return characterSegmenter
    ? Array.from(characterSegmenter.segment(value), ({ segment }) => segment)
    : Array.from(value);
}

function limitCharacters(value: string): string {
  return characters(value).slice(0, MAX_CHARS).join('');
}

function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function renderMixedText(text: string, params: DemoParams) {
  const chars = characters(text);
  const previewSize = `clamp(20px, ${88 / Math.max(4, chars.length)}cqi, ${LARGE_TEXT_SIZE}px)`;
  const runs: Array<{ text: string; fontFamily: string; fontWeight: number }> = [];
  for (const char of chars) {
    const fontFamily = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char)
      ? JAPANESE_FONT_FAMILY
      : /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(char)
        ? CHINESE_FONT_FAMILY
        : /[A-Za-z]/.test(char) ? LETTER_FONT_FAMILY : TEXT_FONT_FAMILY;
    const fontWeight = fontFamily === CHINESE_FONT_FAMILY || fontFamily === JAPANESE_FONT_FAMILY
      ? 500 : 600;
    const previous = runs[runs.length - 1];
    if (previous?.fontFamily === fontFamily) previous.text += char;
    else runs.push({ text: char, fontFamily, fontWeight });
  }

  return runs.map((run, index) => (
    <GlassText
      key={`${index}-${run.fontFamily}`}
      text={run.text}
      fontSize={previewSize}
      fontFamily={run.fontFamily}
      fontWeight={run.fontWeight}
      tabularNums
      {...glassProps(params)}
    />
  ));
}

export function TextDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const [fontSize, setFontSize] = useState(LARGE_TEXT_SIZE);
  const [glyphs, setGlyphs] = useState('Nico');
  const composing = useRef(false);
  const inputHintId = useId();
  const drag = useRef<{ pointerId: number; startY: number; startSize: number } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const applySize = (next: number) => {
    const clamped = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, next)));
    setFontSize((current) => (current === clamped ? current : clamped));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startSize: fontSize };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    applySize(state.startSize - (event.clientY - state.startY) * DRAG_SCALE);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onGlyphsChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setGlyphs(composing.current ? value : limitCharacters(value));
  };

  return (
    <DemoSection
      index="11"
      title={t('text.title')}
      description={t('text.description')}
      params={params}
    >
      <div className="demo-body">
        <div className="demo-group">
          <span className="demo-label">{t('text.label.lockscreen')}</span>
          <div className="demo-lockscreen">
            <span className="demo-lockscreen-date">{t('text.date')}</span>
            <div
              className="demo-clock"
              role="presentation"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <GlassElasticityGroup elasticity={params.elasticity}>
                <GlassText
                  text={formatClock(now)}
                  fontSize={fontSize}
                  fontFamily={LETTER_FONT_FAMILY}
                  fontWeight={600}
                  letterSpacing={-2}
                  tabularNums
                  {...glassProps(params)}
                />
              </GlassElasticityGroup>
            </div>
            <span className="demo-lockscreen-hint">{t('text.hint')}</span>
            <div className="demo-clock-sizes">
              {SIZE_PRESETS.map((size) => (
                <GlassButton
                  key={size}
                  size="sm"
                  aria-pressed={size === fontSize}
                  onClick={() => applySize(size)}
                  {...glassProps(params)}
                >
                  {size}
                </GlassButton>
              ))}
            </div>
          </div>
        </div>

        <div className="demo-group">
          <span className="demo-label">{t('text.label.input')}</span>
          <div className="demo-glyphs">
            <GlassLightGroup>
              <div className="demo-glyphs-toolbar">
                <GlassInput
                  className="demo-glyphs-input"
                  size="md"
                  value={glyphs}
                  onChange={onGlyphsChange}
                  onCompositionStart={() => { composing.current = true; }}
                  onCompositionEnd={(event) => {
                    composing.current = false;
                    setGlyphs(limitCharacters(event.currentTarget.value));
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t('text.inputPlaceholder', { max: MAX_CHARS })}
                  aria-label={t('text.inputAria')}
                  aria-describedby={inputHintId}
                  {...glassProps(params)}
                  cornerRadius={params.cornerRadius}
                />
                <span className="demo-glyphs-note" id={inputHintId}>
                  {t('text.inputHint', { count: characters(glyphs).length, max: MAX_CHARS })}
                </span>
              </div>
              <div className="demo-glyphs-preview">
                <div className="demo-glyphs-line">
                  {renderMixedText(glyphs, params)}
                </div>
              </div>
            </GlassLightGroup>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
