import { type ButtonHTMLAttributes, type MouseEvent as ReactMouseEvent } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassCheckbox.css';

export interface GlassCheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'>,
    GlassExtras {
  /** Controlled checked state. Default false. */
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Default `'md'`. */
  size?: 'sm' | 'md' | 'lg';
  /** Corner radius px. Default 7. */
  cornerRadius?: number;
}

/**
 * Glass checkbox. Controlled: pass `checked` and handle `onChange`.
 * Renders a real button with `role="checkbox"`.
 */
export function GlassCheckbox(props: GlassCheckboxProps) {
  const {
    checked = false,
    onChange,
    size = 'md',
    cornerRadius = 7,
    className,
    disabled,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    hoverBrightnessBoost = 0.35,
    ...rest
  } = props;

  const cls = ['ngs-checkbox', `ngs-checkbox--${size}`, className].filter(Boolean).join(' ');
  const userOnClick = rest.onClick;

  return (
    <GlassSurface
      as="button"
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      cornerRadius={cornerRadius}
      className={cls}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={disabled ? 0 : hoverBrightnessBoost}
      {...rest}
      onClick={(e) => {
        userOnClick?.(e as ReactMouseEvent<HTMLButtonElement>);
        if (!e.defaultPrevented) onChange?.(!checked);
      }}
    >
      <span className="ngs-checkbox-inner">
        <span className="ngs-checkbox-mark" aria-hidden="true" />
        <svg
          className="ngs-checkbox-glyph"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m5 12.5 5 5L19 7" />
        </svg>
      </span>
    </GlassSurface>
  );
}
