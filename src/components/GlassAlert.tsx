import { type HTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassAlert.css';

export type GlassAlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function ToneIcon({ tone }: { tone: GlassAlertTone }) {
  if (tone === 'success') {
    return (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </svg>
    );
  }
  if (tone === 'warning') {
    return (
      <svg {...ICON_PROPS}>
        <path d="M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4" />
        <path d="M12 16.5h.01" />
      </svg>
    );
  }
  if (tone === 'danger') {
    return (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="m9.5 9.5 5 5" />
        <path d="m14.5 9.5-5 5" />
      </svg>
    );
  }
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </svg>
  );
}

export interface GlassAlertProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    GlassExtras {
  /** Icon/dot tint. Default `'neutral'`. */
  tone?: GlassAlertTone;
  /** Replaces the default tone icon. */
  icon?: ReactNode;
  title?: ReactNode;
  /** Shows a dismiss button when provided. */
  onClose?: () => void;
  /** Corner radius px. Default 20. */
  cornerRadius?: number;
  children?: ReactNode;
}

/** Inline glass notice: tone icon + title + description, optionally closable. */
export function GlassAlert(props: GlassAlertProps) {
  const {
    tone = 'neutral',
    icon,
    title,
    onClose,
    cornerRadius = 20,
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

  const cls = ['ngs-alert', className].filter(Boolean).join(' ');

  return (
    <GlassSurface
      cornerRadius={cornerRadius}
      className={cls}
      data-tone={tone}
      role="status"
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={hoverBrightnessBoost}
      {...rest}
    >
      <div className="ngs-alert-inner">
        <span className="ngs-alert-icon" aria-hidden="true">
          {icon ?? <ToneIcon tone={tone} />}
        </span>
        <div className="ngs-alert-texts">
          {title && <div className="ngs-alert-title">{title}</div>}
          {children && <div className="ngs-alert-body">{children}</div>}
        </div>
        {onClose && (
          <button
            type="button"
            className="ngs-alert-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
              <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </GlassSurface>
  );
}
