import { type HTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassBadge.css';

export type GlassBadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface GlassBadgeProps extends HTMLAttributes<HTMLSpanElement>, GlassExtras {
  /** Glyph/dot tint. Default `'neutral'`. */
  tone?: GlassBadgeTone;
  /** Show a leading status dot. */
  dot?: boolean;
  /** Default `'md'`. */
  size?: 'sm' | 'md';
  /** Corner radius px. Default 999. */
  cornerRadius?: number;
  children?: ReactNode;
}

/** Small glass label, e.g. status tags and counters. */
export function GlassBadge(props: GlassBadgeProps) {
  const {
    tone = 'neutral',
    dot = false,
    size = 'md',
    cornerRadius = 999,
    className,
    children,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    hoverBrightnessBoost,
    ...rest
  } = props;

  const cls = ['ngs-badge', `ngs-badge--${size}`, className].filter(Boolean).join(' ');

  return (
    <GlassSurface
      as="span"
      cornerRadius={cornerRadius}
      className={cls}
      data-tone={tone}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={hoverBrightnessBoost}
      {...rest}
    >
      <span className="ngs-badge-inner">
        {dot && <span className="ngs-badge-dot" aria-hidden="true" />}
        {children !== undefined && children !== null && (
          <span className="ngs-badge-text">{children}</span>
        )}
      </span>
    </GlassSurface>
  );
}
