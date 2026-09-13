import { type CSSProperties, type InputHTMLAttributes } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassSlider.css';

export interface GlassSliderProps
  extends Omit<
      InputHTMLAttributes<HTMLInputElement>,
      'size' | 'type' | 'value' | 'onChange' | 'defaultValue'
    >,
    GlassExtras {
  /** Current value. Default 0. */
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  /** Track height. Default `'md'`. */
  size?: 'sm' | 'md';
  /** Corner radius px. Default 999. */
  cornerRadius?: number;
}

/**
 * Glass slider over a native `input[type=range]` (keyboard and touch come for
 * free). The filled portion is driven by the `--ngs-slider-p` CSS variable.
 */
export function GlassSlider(props: GlassSliderProps) {
  const {
    value = 0,
    min = 0,
    max = 100,
    step = 1,
    onChange,
    size = 'md',
    cornerRadius = 999,
    className,
    style,
    disabled,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    hoverBrightnessBoost,
    ...inputProps
  } = props;

  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const cls = ['ngs-slider', `ngs-slider--${size}`, className].filter(Boolean).join(' ');

  return (
    <GlassSurface
      cornerRadius={cornerRadius}
      className={cls}
      style={style}
      data-disabled={disabled ? 'true' : undefined}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={hoverBrightnessBoost}
    >
      <span className="ngs-slider-inner">
        <input
          type="range"
          className="ngs-slider-field"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange?.(Number(e.target.value))}
          style={{ '--ngs-slider-p': `${pct.toFixed(2)}%` } as CSSProperties}
          {...inputProps}
        />
      </span>
    </GlassSurface>
  );
}
