import { type HTMLAttributes } from 'react';
import { GlassSurface, type GlassSurfaceProps } from '../core/GlassSurface';
import './GlassCard.css';

type GlassExtras = Pick<
  GlassSurfaceProps,
  'quality' | 'overLight' | 'optics' | 'elasticity' | 'highlightIntensity'
>;

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement>, GlassExtras {
  /** Content padding, px number or any CSS value. Default 20. */
  padding?: number | string;
  /** Corner radius px. Default 24. */
  cornerRadius?: number;
}

/** Glass card container. */
export function GlassCard(props: GlassCardProps) {
  const {
    padding = 20,
    cornerRadius = 24,
    className,
    style,
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
      cornerRadius={cornerRadius}
      className={['ngs-card', className].filter(Boolean).join(' ')}
      style={style}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      {...rest}
    >
      {/*
       * Padding lives on this inner wrapper, NOT on the surface element:
       * effect/highlight layers (and the displacement map) are aligned to the
       * container's border box, which must stay padding-free.
       */}
      <div className="ngs-card-body" style={{ padding }}>
        {children}
      </div>
    </GlassSurface>
  );
}
