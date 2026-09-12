import { useRef, useState } from 'react';
import { GlassCard, type GlassQuality, type OverLight } from 'nico-glass-kit';
import type { DemoParams } from './App';
import { BACKGROUNDS } from './demos/BackgroundScene';

interface Props {
  params: DemoParams;
  onChange: (p: DemoParams) => void;
  customBg: string | null;
  onUploadBg: (dataUrl: string) => void;
}

const QUALITY_OPTIONS: { value: GlassQuality; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const OVERLIGHT_OPTIONS: { value: OverLight; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: true, label: 'Light' },
  { value: false, label: 'Dark' },
];

const PRESETS: { name: string; patch: Partial<DemoParams> }[] = [
  {
    name: '含蓄 Subtle',
    patch: { displacementScale: 40, blur: 8, saturation: 120, aberration: 0, elasticity: 0, highlight: 0.6 },
  },
  {
    name: '默认 Default',
    patch: { displacementScale: 70, blur: 12, saturation: 140, aberration: 2, elasticity: 0.15, highlight: 1 },
  },
  {
    name: '夸张 Extreme',
    patch: { displacementScale: 140, blur: 16, saturation: 180, aberration: 5, elasticity: 0.35, highlight: 1.6 },
  },
];

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="cp-slider">
      <span className="cp-slider-head">
        <span>{props.label}</span>
        <span className="cp-slider-val">
          {props.format ? props.format(props.value) : props.value}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function ControlPanel({ params, onChange, customBg, onUploadBg }: Props) {
  const [open, setOpen] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof DemoParams>(key: K, value: DemoParams[K]) =>
    onChange({ ...params, [key]: value });

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

  return (
    <aside className={['cp', !open && 'cp--closed'].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="cp-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '收起控制面板' : '展开控制面板'}
      >
        {open ? '→' : '←'}
      </button>
      <GlassCard
        className="cp-card"
        padding={18}
        quality={params.quality}
        overLight={params.overLight}
        elasticity={0}
      >
        <h1 className="cp-title">Liquid Glass</h1>
        <p className="cp-subtitle">nico-glass-kit playground</p>

        <div className="cp-group">
          <span className="cp-label">渲染档位 Quality</span>
          <div className="cp-seg">
            {QUALITY_OPTIONS.map((q) => (
              <button
                key={q.value}
                type="button"
                className={['cp-seg-btn', params.quality === q.value && 'is-active']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => set('quality', q.value)}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cp-group">
          <span className="cp-label">明暗 overLight</span>
          <div className="cp-seg">
            {OVERLIGHT_OPTIONS.map((o) => (
              <button
                key={o.label}
                type="button"
                className={['cp-seg-btn', params.overLight === o.value && 'is-active']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => set('overLight', o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="cp-group">
          <span className="cp-label">背景 Background</span>
          <div className="cp-bgs">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.id}
                type="button"
                className={['cp-bg-btn', `cp-bg-${b.id}`, params.background === b.id && 'is-active']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => set('background', b.id)}
                aria-label={b.label}
                title={b.label}
              />
            ))}
            {customBg && (
              <button
                type="button"
                className={['cp-bg-btn', 'cp-bg-image', params.background === 'custom' && 'is-active']
                  .filter(Boolean)
                  .join(' ')}
                style={{ backgroundImage: `url(${customBg})` }}
                onClick={() => set('background', 'custom')}
                aria-label="自定义背景"
                title="自定义背景"
              />
            )}
            <button
              type="button"
              className="cp-bg-btn cp-bg-upload"
              onClick={() => fileRef.current?.click()}
              aria-label="上传背景图片"
              title="上传背景图片"
            >
              +
            </button>
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
          </div>
        </div>

        <div className="cp-group">
          <Slider
            label="位移强度 Displacement"
            min={0}
            max={140}
            step={1}
            value={params.displacementScale}
            onChange={(v) => set('displacementScale', v)}
          />
          <Slider
            label="模糊 Blur"
            min={0}
            max={24}
            step={0.5}
            value={params.blur}
            format={(v) => `${v}px`}
            onChange={(v) => set('blur', v)}
          />
          <Slider
            label="饱和度 Saturation"
            min={100}
            max={200}
            step={1}
            value={params.saturation}
            format={(v) => `${v}%`}
            onChange={(v) => set('saturation', v)}
          />
          <Slider
            label="色差 Aberration"
            min={0}
            max={6}
            step={0.5}
            value={params.aberration}
            onChange={(v) => set('aberration', v)}
          />
          <Slider
            label="高光 Highlight"
            min={0}
            max={2}
            step={0.05}
            value={params.highlight}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set('highlight', v)}
          />
          <Slider
            label="弹性 Elasticity"
            min={0}
            max={0.5}
            step={0.01}
            value={params.elasticity}
            onChange={(v) => set('elasticity', v)}
          />
          <Slider
            label="圆角 Radius"
            min={8}
            max={80}
            step={1}
            value={params.cornerRadius}
            format={(v) => `${v}px`}
            onChange={(v) => set('cornerRadius', v)}
          />
        </div>

        <div className="cp-group">
          <span className="cp-label">预设 Presets</span>
          <div className="cp-presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="cp-preset-btn"
                onClick={() => onChange({ ...params, ...p.patch })}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <p className="cp-hint">
          高光会跟随鼠标方向；移出后回到均匀描边。折射仅在 Chromium
          生效（backdrop-filter: url()），Safari / Firefox 自动降级为 Low。
        </p>
      </GlassCard>
    </aside>
  );
}
