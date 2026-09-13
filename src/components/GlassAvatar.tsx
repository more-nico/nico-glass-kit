import { type HTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassAvatar.css';

const SIZE_PX = { sm: 32, md: 40, lg: 52 } as const;

export interface GlassAvatarProps extends HTMLAttributes<HTMLSpanElement>, GlassExtras {
  /** Image URL. Without it, `initials` (or nothing) is shown. */
  src?: string;
  alt?: string;
  /** Fallback content shown without `src`, e.g. initials or an icon. */
  initials?: ReactNode;
  /** Default `'md'`, or a custom pixel size. */
  size?: 'sm' | 'md' | 'lg' | number;
  /** Corner radius px. Default 999. */
  cornerRadius?: number;
}

/** Circular glass avatar with an image or fallback initials inside a rim. */
export function GlassAvatar(props: GlassAvatarProps) {
  const {
    src,
    alt,
    initials,
    size = 'md',
    cornerRadius = 999,
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

  const px = typeof size === 'number' ? size : SIZE_PX[size];
  const cls = ['ngs-avatar', className].filter(Boolean).join(' ');

  return (
    <GlassSurface
      as="span"
      cornerRadius={cornerRadius}
      className={cls}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={hoverBrightnessBoost}
      {...rest}
    >
      <span className="ngs-avatar-inner" style={{ width: px, height: px, fontSize: px * 0.38 }}>
        {src ? (
          <img className="ngs-avatar-img" src={src} alt={alt ?? ''} draggable={false} />
        ) : (
          <span className="ngs-avatar-initials">{initials}</span>
        )}
      </span>
    </GlassSurface>
  );
}
