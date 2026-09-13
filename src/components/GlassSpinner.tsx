import { type HTMLAttributes } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassSpinner.css';

export interface GlassSpinnerProps extends HTMLAttributes<HTMLSpanElement>, GlassExtras {
  /** Default `'md'`. */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name. Default `'加载中'`. */
  label?: string;
}

/** Spinning progress ring on a round glass pill. */
export function GlassSpinner(props: GlassSpinnerProps) {
  const {
    size = 'md',
    label = '加载中',
    className,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    hoverBrightnessBoost,
    ...rest
  } = props;

  const cls = ['ngs-spinner', `ngs-spinner--${size}`, className].filter(Boolean).join(' ');

  return (
    <GlassSurface
      as="span"
      cornerRadius={999}
      className={cls}
      role="status"
      aria-label={label}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={hoverBrightnessBoost}
      {...rest}
    >
      <span className="ngs-spinner-inner" aria-hidden="true">
        <span className="ngs-spinner-ring" />
      </span>
    </GlassSurface>
  );
}
