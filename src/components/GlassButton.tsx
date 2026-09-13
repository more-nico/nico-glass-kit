import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassButton.css';

export interface GlassButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    GlassExtras {
  /** `'capsule'` (pill) or `'icon'` (round icon button). Default `'capsule'`. */
  variant?: 'capsule' | 'icon';
  /** Default `'md'`. */
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  /**
   * Extra brightness added to the configured optics brightness while hovered.
   * Default 0.5. Pass 0 to disable. No effect while `disabled`.
   */
  hoverBrightnessBoost?: number;
}

/** Glass button: capsule or round icon variant, with hover/press feedback. */
export function GlassButton(props: GlassButtonProps) {
  const {
    variant = 'capsule',
    size = 'md',
    icon,
    disabled,
    hoverBrightnessBoost = 0.5,
    className,
    children,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
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
      disabled={disabled}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={disabled ? 0 : hoverBrightnessBoost}
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
