import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassTooltip.css';

export type GlassTooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface GlassTooltipProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'content'>,
    GlassExtras {
  /** Tooltip bubble content. */
  content: ReactNode;
  /** Default `'top'`. */
  placement?: GlassTooltipPlacement;
  /** Show delay in ms. Default 150. */
  delay?: number;
  children?: ReactNode;
}

/**
 * Hover/focus tooltip. The bubble is a small glass surface; it stays out of
 * the pointer path and closes on Esc.
 */
export function GlassTooltip(props: GlassTooltipProps) {
  const {
    content,
    placement = 'top',
    delay = 150,
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

  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const id = useId();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onPointerEnter = (_e: PointerEvent<HTMLSpanElement>) => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(true), delay);
  };
  const onPointerLeave = (_e: PointerEvent<HTMLSpanElement>) => {
    clearTimer();
    setOpen(false);
  };
  const onFocus = (_e: FocusEvent<HTMLSpanElement>) => {
    clearTimer();
    setOpen(true);
  };
  const onBlur = (_e: FocusEvent<HTMLSpanElement>) => {
    clearTimer();
    setOpen(false);
  };

  return (
    <span
      className={['ngs-tooltip-wrap', className].filter(Boolean).join(' ')}
      {...rest}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <GlassSurface
          as="span"
          cornerRadius={10}
          className={`ngs-tooltip ngs-tooltip--${placement}`}
          role="tooltip"
          id={id}
          quality={quality}
          overLight={overLight}
          optics={optics}
          elasticity={elasticity}
          highlightIntensity={highlightIntensity}
          hoverBrightnessBoost={hoverBrightnessBoost}
        >
          <span className="ngs-tooltip-inner">{content}</span>
        </GlassSurface>
      )}
    </span>
  );
}
