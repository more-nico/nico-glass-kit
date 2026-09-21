import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { GlassButton, GlassInput, GlassLightGroup, GlassSurface, GlassText } from 'nico-glass-kit';
import type { DemoParams } from '../App';
import { useI18n } from '../i18n';
import { DemoSection } from './DemoSection';
import { glassProps } from './demoProps';
import './TextDemo.css';

const MIN_SIZE = 56;
const MAX_SIZE = 208;
const SIZE_PRESETS = [72, 132, 192];
const DRAG_SCALE = 0.7;

/** The preview field accepts at most this many displayable ASCII characters. */
const MAX_CHARS = 4;

const ASCII_ROWS = Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 19 }, (_, col) => String.fromCharCode(32 + row * 19 + col)).join(''),
);

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

export function TextDemo({ params }: { params: DemoParams }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const [fontSize, setFontSize] = useState(132);
  const [glyphs, setGlyphs] = useState('Nico');
  const [grid, setGrid] = useState(false);
  const [showAscii, setShowAscii] = useState(false);
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
                fontWeight={600}
                letterSpacing={-2}
                tabularNums
                {...glassProps(params)}
                elasticity={0}
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
                <GlassText
                  text={glyphs}
                  fontSize={96}
                  fontWeight={600}
                  tabularNums
                  {...glassProps(params)}
                  elasticity={0}
                />
              </div>
            </GlassLightGroup>
            <span className="demo-glyphs-note">
              {t('text.inputHint', { count: glyphs.length, max: MAX_CHARS })}
            </span>
          </div>
        </div>
        <div className="demo-group demo-text-comparison">
          <span className="demo-label">{t('text.label.material')}</span>
          <div className="demo-text-samples">
            <label className="demo-text-toggle">
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
              {t('text.grid')}
            </label>
            <div className={`demo-text-stage${grid ? ' demo-text-stage-grid' : ''}`}>
              <GlassLightGroup>
                <GlassSurface className="demo-text-reference" {...glassProps(params)} elasticity={0}>
                  GlassSurface
                </GlassSurface>
                {['01:00', '08:59', 'B8@%', 'il!.,:;'].map((text) => (
                  <GlassText key={text} text={text} fontSize={`min(${fontSize}px, 12vw)`} fontWeight={600}
                    tabularNums {...glassProps(params)} elasticity={0} />
                ))}
              </GlassLightGroup>
            </div>
            <details onToggle={(e) => setShowAscii(e.currentTarget.open)}>
              <summary>{t('text.ascii')}</summary>
              {showAscii && <div className="demo-ascii-sheet">
                {ASCII_ROWS.map((text, index) => (
                  <div key={index}>
                    <code>{text.replace(' ', '␠')}</code>
                    <GlassText text={text} fontSize="clamp(16px, 2.5vw, 42px)"
                      fontFamily="monospace" fontWeight={700} {...glassProps(params)} elasticity={0} />
                  </div>
                ))}
              </div>}
            </details>
          </div>
        </div>
      </div>
    </DemoSection>
  );
}
