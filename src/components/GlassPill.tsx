import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassPill.css';

export interface GlassPillProps extends HTMLAttributes<HTMLDivElement>, GlassExtras {
  icon?: ReactNode;
  /** Main text. */
  primary: ReactNode;
  /** Subdued secondary text. */
  secondary?: ReactNode;
  /** Controlled visibility, default true. */
  visible?: boolean;
  /** Auto-dismiss after N ms (calls onClose). */
  autoHideDuration?: number;
  onClose?: () => void;
}

const EXIT_MS = 320;

/**
 * Floating information capsule (e.g. "Yesterday 23:07"), usable as a toast.
 * Fixed at the top-centre of the viewport with enter/exit animation.
 */
export function GlassPill(props: GlassPillProps) {
  const {
    icon,
    primary,
    secondary,
    visible = true,
    autoHideDuration,
    onClose,
    className,
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    ...rest
  } = props;

  const [shouldRender, setShouldRender] = useState(visible);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      setLeaving(false);
      return;
    }
    if (!shouldRender) return;
    setLeaving(true);
    const t = window.setTimeout(() => {
      setShouldRender(false);
      setLeaving(false);
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [visible, shouldRender]);

  useEffect(() => {
    if (!visible || !autoHideDuration || !onClose) return;
    const t = window.setTimeout(onClose, autoHideDuration);
    return () => window.clearTimeout(t);
  }, [visible, autoHideDuration, onClose]);

  if (!shouldRender) return null;

  return (
    <GlassSurface
      cornerRadius={999}
      className={['ngs-pill', leaving && 'ngs-pill--leaving', className]
        .filter(Boolean)
        .join(' ')}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      role="status"
      {...rest}
    >
      <span className="ngs-pill-inner">
        {icon && (
          <span className="ngs-pill-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="ngs-pill-texts">
          <span className="ngs-pill-primary">{primary}</span>
          {secondary && <span className="ngs-pill-secondary">{secondary}</span>}
        </span>
      </span>
    </GlassSurface>
  );
}
