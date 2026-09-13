import { type InputHTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassInput.css';

export interface GlassInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    GlassExtras {
  /** Control height / typography scale. Default `'md'`. */
  size?: 'sm' | 'md' | 'lg';
  /** Marks the field invalid (error-tinted focus ring). */
  invalid?: boolean;
  /** Content before the field, usually an icon. */
  leading?: ReactNode;
  /** Content after the field, e.g. a clear button. */
  trailing?: ReactNode;
  /** Corner radius px. Default 14. */
  cornerRadius?: number;
}

/**
 * Glass text field. `className`/`style` land on the glass surface; every other
 * native input attribute (`value`, `onChange`, `placeholder`, `type`, …) is
 * forwarded to the inner `<input>`.
 */
export function GlassInput(props: GlassInputProps) {
  const {
    size = 'md',
    invalid,
    leading,
    trailing,
    cornerRadius = 14,
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

  const cls = ['ngs-input', `ngs-input--${size}`, className].filter(Boolean).join(' ');

  return (
    <GlassSurface
      as="label"
      cornerRadius={cornerRadius}
      className={cls}
      style={style}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={hoverBrightnessBoost}
    >
      <span className="ngs-input-inner">
        {leading && (
          <span className="ngs-input-affix" aria-hidden="true">
            {leading}
          </span>
        )}
        <input
          className="ngs-input-field"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          {...inputProps}
        />
        {trailing && (
          <span className="ngs-input-affix ngs-input-affix--trailing">{trailing}</span>
        )}
      </span>
    </GlassSurface>
  );
}
