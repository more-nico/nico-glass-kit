import { type HTMLAttributes } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassProgress.css';

export interface GlassProgressProps extends HTMLAttributes<HTMLDivElement>, GlassExtras {
  /** Current value, clamped to `0..max`. Default 0. */
  value?: number;
  /** Default 1. */
  max?: number;
  /** Bar thickness. Default `'md'`. */
  size?: 'sm' | 'md' | 'lg';
  /** Corner radius px. Default 999. */
  cornerRadius?: number;
  /** Accessible name announced for the progressbar. */
  label?: string;
}

/** Determinate progress bar on a glass capsule track. */
export function GlassProgress(props: GlassProgressProps) {
  const {
    value = 0,
    max = 1,
    size = 'md',
    cornerRadius = 999,
    label,
    className,
    style,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    hoverBrightnessBoost,
    ...rest
  } = props;

  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const cls = ['ngs-progress', `ngs-progress--${size}`, className].filter(Boolean).join(' ');

  return (
    <GlassSurface
      cornerRadius={cornerRadius}
      className={cls}
      style={style}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={hoverBrightnessBoost}
      {...rest}
    >
      <span className="ngs-progress-inner">
        <span
          className="ngs-progress-fill"
          style={{ width: `${(ratio * 100).toFixed(2)}%` }}
        />
      </span>
    </GlassSurface>
  );
}
