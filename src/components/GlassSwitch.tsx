import { type ButtonHTMLAttributes, type MouseEvent as ReactMouseEvent } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassSwitch.css';

export interface GlassSwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'>,
    GlassExtras {
  /** Controlled on/off state. Default false. */
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** Default `'md'`. */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Glass toggle switch. Controlled: pass `checked` and handle `onChange`.
 * Renders a real button with `role="switch"` so Space/Enter toggle it.
 */
export function GlassSwitch(props: GlassSwitchProps) {
  const {
    checked = false,
    onChange,
    size = 'md',
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

  const cls = ['ngs-switch', `ngs-switch--${size}`, className].filter(Boolean).join(' ');
  const userOnClick = rest.onClick;

  return (
    <GlassSurface
      as="button"
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      cornerRadius={999}
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
      <span className="ngs-switch-inner">
        <span className="ngs-switch-track" aria-hidden="true" />
        <span className="ngs-switch-knob" aria-hidden="true" />
      </span>
    </GlassSurface>
  );
}
