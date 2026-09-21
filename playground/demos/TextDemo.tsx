import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GlassButton, GlassInput, GlassLightGroup, GlassText } from 'nico-glass-kit';
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

/** The preview field accepts at most this many displayable ASCII characters. */
const MAX_CHARS = 4;

/** Keeps `\r\n\t` as spaces and drops everything outside 0x20–0x7E. */
function sanitiseAscii(value: string): string {
  let out = '';
  for (let i = 0; i < value.length && out.length < MAX_CHARS; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x0d || code === 0x0a || code === 0x09) {
      out += ' ';
    } else if (code >= 0x20 && code <= 0x7e) {
      out += value[i];
    }
  }
  return out;
}

function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function renderMixedText(text: string, params: DemoParams) {
  const runs: Array<{ text: string; fontFamily: string }> = [];
  for (const char of text) {
    const fontFamily = /[A-Za-z]/.test(char) ? LETTER_FONT_FAMILY : TEXT_FONT_FAMILY;
    const previous = runs[runs.length - 1];
    if (previous?.fontFamily === fontFamily) previous.text += char;
    else runs.push({ text: char, fontFamily });
  }

  return runs.map((run, index) => (
    <GlassText
      key={`${index}-${run.fontFamily}`}
      text={run.text}
      fontSize={LARGE_TEXT_SIZE}
      fontFamily={run.fontFamily}
      fontWeight={600}
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
    setGlyphs(sanitiseAscii(event.target.value));
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
              <GlassText
                text={formatClock(now)}
                fontSize={fontSize}
                fontFamily={TEXT_FONT_FAMILY}
                fontWeight={600}
                letterSpacing={-2}
                tabularNums
                {...glassProps(params)}
              />
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
              <GlassInput
                className="demo-glyphs-input"
                size="md"
                value={glyphs}
                onChange={onGlyphsChange}
                maxLength={MAX_CHARS}
                spellCheck={false}
                autoComplete="off"
                placeholder={t('text.inputPlaceholder')}
                aria-label={t('text.inputAria')}
                {...glassProps(params)}
                cornerRadius={params.cornerRadius}
              />
              <div className="demo-glyphs-preview">
                {renderMixedText(glyphs, params)}
              </div>
            </GlassLightGroup>
            <span className="demo-glyphs-note">
              {t('text.inputHint', { count: glyphs.length, max: MAX_CHARS })}
            </span>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
