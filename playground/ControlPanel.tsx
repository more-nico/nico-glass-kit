import { useRef, useState } from 'react';
import {
  DEFAULT_LENS_MAP_RASTER_SCALE,
  DEFAULT_OPTICS,
  MAX_LENS_MAP_RASTER_SCALE,
  MIN_LENS_MAP_RASTER_SCALE,
  GlassButton,
  GlassCard,
  GlassLightGroup,
  GlassSegmentedControl,
  GlassSlider,
  GlassSurface,
  type GlassOptics,
  type GlassQuality,
  type OverLight,
} from 'nico-glass-kit';
import type { DemoParams } from './App';
import { useI18n, type MessageKey } from './i18n';
import { BACKGROUND_IDS } from './demos/BackgroundScene';
import { glassProps } from './demos/demoProps';

interface Props {
  params: DemoParams;
  onChange: (p: DemoParams) => void;
  customBg: string | null;
  onUploadBg: (dataUrl: string) => void;
}

const QUALITY_ITEMS: { key: string; label: string }[] = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
];

const OVERLIGHT_ITEMS: { key: string; label: string }[] = [
  { key: 'auto', label: 'Auto' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

function overLightKey(value: OverLight): string {
  if (value === 'auto') return 'auto';
  return value ? 'light' : 'dark';
}

function overLightFromKey(key: string): OverLight {
  if (key === 'auto') return 'auto';
  return key === 'light';
}

/** Presets are sparse optics layers over DEFAULT_OPTICS (ported from the reference). */
const PRESETS: { key: MessageKey; optics: Partial<GlassOptics> }[] = [
  {
    key: 'panel.preset.subtle',
    optics: {
      blur: 18,
      saturation: 110,
      brightness: 0.97,
      tintStrength: 0.14,
      refraction: 0.22,
      depth: 8,
      curvature: 0.75,
    },
  },
  {
    key: 'panel.preset.default',
    optics: { ...DEFAULT_OPTICS },
  },
  {
    key: 'panel.preset.clear',
    optics: {
      blur: 8,
      saturation: 106,
      brightness: 1,
      tintStrength: 0.06,
      refraction: 0.5,
      depth: 14,
      curvature: 0.6,
    },
  },
  {
    key: 'panel.preset.vivid',
    optics: {
      blur: 26,
      saturation: 165,
      brightness: 1.02,
      tintStrength: 0.32,
      refraction: 0.62,
      depth: 16,
      curvature: 0.5,
      dispersion: 0.18,
    },
  },
];

const TINT_HEX_FALLBACK = '#12141a';

/** Parse the current tint colour into a hex value for the color input. */
function tintToHex(tint: string): string {
  const s = tint.trim();
  const hex6 = /^#([0-9a-f]{6})$/i.exec(s);
  if (hex6) return s.toLowerCase();
  const hex3 = /^#([0-9a-f]{3})$/i.exec(s);
  if (hex3) {
    const expanded = s
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('');
    return `#${expanded}`;
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(s);
  if (rgb) {
    const parts = rgb[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return (
        '#' +
        parts
          .slice(0, 3)
          .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
          .join('')
      );
    }
  }
  return TINT_HEX_FALLBACK; // light-dark(...) and anything unparsable
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  params: DemoParams;
}) {
  return (
    <div className="cp-slider">
      <span className="cp-slider-head">
        <span>{props.label}</span>
        <span className="cp-slider-val">
          {props.format ? props.format(props.value) : props.value}
        </span>
      </span>
      <GlassSlider
        className="cp-slider-track"
        size="sm"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={props.onChange}
        {...glassProps(props.params)}
      />
    </div>
  );
}

function Group(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="cp-group">
      <span className="cp-label">{props.title}</span>
      {props.children}
    </div>
  );
}

export function ControlPanel({ params, onChange, customBg, onUploadBg }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof DemoParams>(key: K, value: DemoParams[K]) =>
    onChange({ ...params, [key]: value });
  const setOptics = <K extends keyof GlassOptics>(key: K, value: GlassOptics[K]) =>
    onChange({ ...params, optics: { ...params.optics, [key]: value } });

  const onFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUploadBg(reader.result);
        set('background', 'custom');
      }
    };
    reader.readAsDataURL(file);
  };

  const tint = params.optics.tint;
  const tintIsAuto = tint === DEFAULT_OPTICS.tint;

  return (
    <aside className={['cp', !open && 'cp--closed'].filter(Boolean).join(' ')}>
      <GlassButton
        variant="icon"
        size="md"
        className="cp-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t('panel.collapse') : t('panel.expand')}
        icon={<span aria-hidden="true">{open ? '→' : '←'}</span>}
        {...glassProps(params)}
      />
      <GlassCard
        className="cp-card"
        padding={18}
        quality={params.quality}
        overLight={params.overLight}
        elasticity={0}
      >
        <h1 className="cp-title">Nico Glass</h1>
        <p className="cp-subtitle">{t('panel.subtitle')}</p>

        <Group title={t('panel.group.quality')}>
          <GlassSegmentedControl
            className="cp-seg-control"
            size="sm"
            items={QUALITY_ITEMS}
            value={params.quality}
            onChange={(key) => set('quality', key as GlassQuality)}
            {...glassProps(params)}
          />
          <GlassSegmentedControl
            className="cp-seg-control cp-seg-control--stack"
            size="sm"
            items={OVERLIGHT_ITEMS}
            value={overLightKey(params.overLight)}
            onChange={(key) => set('overLight', overLightFromKey(key))}
            {...glassProps(params)}
          />
        </Group>

        <Group title={t('panel.group.background')}>
          <GlassLightGroup>
            <div className="cp-bgs">
              {BACKGROUND_IDS.map((id) => {
                const label = t(`bg.${id}`);
                return (
                  <GlassSurface
                    key={id}
                    as="button"
                    type="button"
                    cornerRadius={999}
                    className={['cp-bg-btn', params.background === id && 'is-active']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => set('background', id)}
                    aria-label={label}
                    title={label}
                    {...glassProps(params)}
                  >
                    <span className={`cp-bg-swatch cp-bg-${id}`} aria-hidden="true" />
                  </GlassSurface>
                );
              })}
              {customBg && (
                <GlassSurface
                  as="button"
                  type="button"
                  cornerRadius={999}
                  className={['cp-bg-btn', params.background === 'custom' && 'is-active']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => set('background', 'custom')}
                  aria-label={t('panel.customBackground')}
                  title={t('panel.customBackground')}
                  {...glassProps(params)}
                >
                  <span
                    className="cp-bg-swatch"
                    style={{ backgroundImage: `url(${customBg})` }}
                    aria-hidden="true"
                  />
                </GlassSurface>
              )}
              <GlassSurface
                as="button"
                type="button"
                cornerRadius={999}
                className="cp-bg-btn cp-bg-upload"
                onClick={() => fileRef.current?.click()}
                aria-label={t('panel.customBackground')}
                title={t('panel.uploadTitle')}
                {...glassProps(params)}
              >
                <span className="cp-bg-upload-label">{t('panel.custom')}</span>
              </GlassSurface>
            </div>
          </GlassLightGroup>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </Group>

        <Group title={t('panel.group.material')}>
          <Slider
            label={t('panel.blur')}
            min={0}
            max={64}
            step={1}
            value={params.optics.blur}
            format={(v) => `${v}px`}
            onChange={(v) => setOptics('blur', v)}
            params={params}
          />
          <Slider
            label={t('panel.saturation')}
            min={0}
            max={300}
            step={1}
            value={params.optics.saturation}
            format={(v) => `${v}%`}
            onChange={(v) => setOptics('saturation', v)}
            params={params}
          />
          <Slider
            label={t('panel.brightness')}
            min={0}
            max={2}
            step={0.01}
            value={params.optics.brightness}
            format={(v) => v.toFixed(2)}
            onChange={(v) => setOptics('brightness', v)}
            params={params}
          />
          <div className="cp-slider">
            <span className="cp-slider-head">
              <span>{t('panel.tint')}</span>
              <span className="cp-slider-val">{tintIsAuto ? 'auto' : tintToHex(tint)}</span>
            </span>
            <div className="cp-tint-row">
              <input
                type="color"
                className="cp-color"
                value={tintToHex(tint)}
                onChange={(e) => setOptics('tint', e.target.value)}
                aria-label={t('panel.tintColor')}
              />
              <GlassButton
                size="sm"
                onClick={() => setOptics('tint', DEFAULT_OPTICS.tint)}
                disabled={tintIsAuto}
                title={t('panel.tintRestore')}
                {...glassProps(params)}
              >
                Auto
              </GlassButton>
            </div>
          </div>
          <Slider
            label={t('panel.tintStrength')}
            min={0}
            max={1}
            step={0.01}
            value={params.optics.tintStrength}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setOptics('tintStrength', v)}
            params={params}
          />
        </Group>

        <Group title={t('panel.group.performance')}>
          <Slider
            label={t('panel.mapScale')}
            min={MIN_LENS_MAP_RASTER_SCALE}
            max={MAX_LENS_MAP_RASTER_SCALE}
            step={0.05}
            value={params.mapRasterScale}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set('mapRasterScale', v)}
            params={params}
          />
          <p className="cp-hint">
            {t('panel.mapScaleHint', {
              default: Math.round(DEFAULT_LENS_MAP_RASTER_SCALE * 100),
              max: Math.round(MAX_LENS_MAP_RASTER_SCALE * 100),
            })}
          </p>
        </Group>

        <Group title={t('panel.group.refraction')}>
          <Slider
            label={t('panel.refraction')}
            min={0}
            max={1}
            step={0.01}
            value={params.optics.refraction}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setOptics('refraction', v)}
            params={params}
          />
          <Slider
            label={t('panel.depth')}
            min={0}
            max={40}
            step={1}
            value={params.optics.depth}
            format={(v) => `${v}px`}
            onChange={(v) => setOptics('depth', v)}
            params={params}
          />
          <Slider
            label={t('panel.curvature')}
            min={0}
            max={1}
            step={0.01}
            value={params.optics.curvature}
            format={(v) => v.toFixed(2)}
            onChange={(v) => setOptics('curvature', v)}
            params={params}
          />
          <Slider
            label={t('panel.dispersion')}
            min={0}
            max={1}
            step={0.01}
            value={params.optics.dispersion}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setOptics('dispersion', v)}
            params={params}
          />
        </Group>

        <Group title={t('panel.group.interaction')}>
          <Slider
            label={t('panel.highlight')}
            min={0}
            max={2}
            step={0.05}
            value={params.highlight}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set('highlight', v)}
            params={params}
          />
          <Slider
            label={t('panel.elasticity')}
            min={0}
            max={0.5}
            step={0.01}
            value={params.elasticity}
            onChange={(v) => set('elasticity', v)}
            params={params}
          />
        </Group>

        <Group title={t('panel.group.shape')}>
          <Slider
            label={t('panel.radius')}
            min={8}
            max={80}
            step={1}
            value={params.cornerRadius}
            format={(v) => `${v}px`}
            onChange={(v) => set('cornerRadius', v)}
            params={params}
          />
        </Group>

        <Group title={t('panel.group.presets')}>
          <GlassLightGroup>
            <div className="cp-presets">
              {PRESETS.map((p) => (
                <GlassButton
                  key={p.key}
                  size="sm"
                  onClick={() => onChange({ ...params, optics: { ...params.optics, ...p.optics } })}
                  {...glassProps(params)}
                >
                  {t(p.key)}
                </GlassButton>
              ))}
            </div>
          </GlassLightGroup>
        </Group>

        <p className="cp-hint">{t('panel.hint')}</p>
      </GlassCard>
    </aside>
  );
}
