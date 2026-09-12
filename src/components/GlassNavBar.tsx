import { type HTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassSurfaceProps } from '../core/GlassSurface';
import './GlassNavBar.css';

type GlassExtras = Pick<
  GlassSurfaceProps,
  'quality' | 'overLight' | 'optics' | 'elasticity' | 'highlightIntensity'
>;

export interface GlassNavBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    GlassExtras {
  title?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Corner radius px. Default 24. */
  cornerRadius?: number;
}

/**
 * Floating top navigation bar (iOS 26 style): fixed at the top by default,
 * with title + leading/trailing slots. Override `style.position` to embed.
 */
export function GlassNavBar(props: GlassNavBarProps) {
  const {
    title,
    leading,
    trailing,
    cornerRadius = 24,
    className,
    children,
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    ...rest
  } = props;

  return (
    <GlassSurface
      as="nav"
      cornerRadius={cornerRadius}
      className={['ngs-navbar', className].filter(Boolean).join(' ')}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      {...rest}
    >
      <div className="ngs-navbar-inner">
        <div className="ngs-navbar-side">{leading}</div>
        <div className="ngs-navbar-title">{title}</div>
        <div className="ngs-navbar-side ngs-navbar-side--trailing">{trailing}</div>
      </div>
      {children}
    </GlassSurface>
  );
}
