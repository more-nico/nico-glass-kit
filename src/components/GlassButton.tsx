import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassSurfaceProps } from '../core/GlassSurface';
import './GlassButton.css';

type GlassExtras = Pick<
  GlassSurfaceProps,
  | 'quality'
  | 'overLight'
  | 'blur'
  | 'saturation'
  | 'displacementScale'
  | 'aberrationIntensity'
  | 'elasticity'
  | 'highlightIntensity'
  | 'profile'
  | 'bezelWidth'
>;

export interface GlassButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    GlassExtras {
  /** `'capsule'` (pill) or `'icon'` (round icon button). Default `'capsule'`. */
  variant?: 'capsule' | 'icon';
  /** Default `'md'`. */
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
}

/** Glass button: capsule or round icon variant, with hover/press feedback. */
export function GlassButton(props: GlassButtonProps) {
  const {
    variant = 'capsule',
    size = 'md',
    icon,
    className,
    children,
    // glass extras
    quality,
    overLight,
    blur,
    saturation,
    displacementScale,
    aberrationIntensity,
    elasticity,
    highlightIntensity,
    profile,
    bezelWidth,
    ...rest
  } = props;

  const cls = [
    'ngs-btn',
    `ngs-btn--${variant}`,
    `ngs-btn--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <GlassSurface
      as="button"
      type="button"
      cornerRadius={999}
      className={cls}
      quality={quality}
      overLight={overLight}
      blur={blur}
      saturation={saturation}
      displacementScale={displacementScale}
      aberrationIntensity={aberrationIntensity}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      profile={profile}
      bezelWidth={bezelWidth}
      {...rest}
    >
      <span className="ngs-btn-content">
        {icon && (
          <span className="ngs-btn-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {children}
      </span>
    </GlassSurface>
  );
}
