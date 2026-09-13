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
 * free). The frosted fill is a content-layer element driven by the unitless
 * `--ngs-slider-f` variable; its right end is carved into a concave notch that
 * matches the thumb so no fill sits behind the glass dot.
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
  // Inner rail radius follows the outer glass radius minus the content padding
  // so the two arcs stay concentric (must match --ngs-slider-pad in the CSS).
  const pad = size === 'sm' ? 3 : 4;
  const innerRadius = Math.max(0, cornerRadius - pad);
  // Unitless 0..1 progress for the content-layer fill: the CSS sizes it so its
  // concave right notch matches the thumb and ends at the thumb's centre.
  const progress = pct / 100;

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
      {/* Vars live on the wrapper so both the rail fill (sibling) and the
          input's track/thumb pseudo-elements can read them. */}
      <span
        className="ngs-slider-inner"
        style={
          {
            '--ngs-slider-f': progress.toFixed(4),
            '--ngs-slider-radius': `${innerRadius}px`,
          } as CSSProperties
        }
      >
        <span className="ngs-slider-rail" aria-hidden="true">
          <span className="ngs-slider-fill" />
        </span>
        <input
          type="range"
          className="ngs-slider-field"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange?.(Number(e.target.value))}
          {...inputProps}
        />
      </span>
    </GlassSurface>
  );
}
