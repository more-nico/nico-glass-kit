import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { GlassCard } from './GlassCard';
import { type GlassExtras } from '../core/GlassSurface';
import './GlassModal.css';

const EXIT_MS = 200;

export interface GlassModalProps extends GlassExtras {
  /** Controlled visibility. */
  open?: boolean;
  /** Called on Esc, backdrop click (when enabled) and the close button. */
  onClose?: () => void;
  title?: ReactNode;
  /** Usually action buttons aligned to the trailing edge. */
  footer?: ReactNode;
  /** Close when the dimmed backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Panel width px. Default 420. */
  width?: number;
  /** Panel corner radius px. Default 28. */
  cornerRadius?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * Controlled glass dialog over a dimmed backdrop. Enter/exit are animated;
 * Esc closes, backdrop click closes unless `closeOnBackdrop={false}`.
 * Renders nothing while closed (no portal).
 */
export function GlassModal(props: GlassModalProps) {
  const {
    open = false,
    onClose,
    title,
    footer,
    closeOnBackdrop = true,
    width = 420,
    cornerRadius = 28,
    className,
    children,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
  } = props;

  const [shouldRender, setShouldRender] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
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
  }, [open, shouldRender]);

  useEffect(() => {
    if (open) overlayRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!shouldRender) return null;

  const onBackdrop = (e: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
  };

  return (
    <div
      ref={overlayRef}
      className={['ngs-modal-overlay', leaving && 'is-leaving'].filter(Boolean).join(' ')}
      tabIndex={-1}
      onClick={onBackdrop}
    >
      <GlassCard
        className={['ngs-modal-panel', className].filter(Boolean).join(' ')}
        style={{ width, maxWidth: '100%' }}
        padding={0}
        cornerRadius={cornerRadius}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        quality={quality}
        overLight={overLight}
        optics={optics}
        elasticity={elasticity}
        highlightIntensity={highlightIntensity}
      >
        {(title || onClose) && (
          <div className="ngs-modal-head">
            {title && (
              <h2 className="ngs-modal-title" id={titleId}>
                {title}
              </h2>
            )}
            {onClose && (
              <button
                type="button"
                className="ngs-modal-close"
                onClick={onClose}
                aria-label="关闭"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                  <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="ngs-modal-body">{children}</div>
        {footer && <div className="ngs-modal-foot">{footer}</div>}
      </GlassCard>
    </div>
  );
}
