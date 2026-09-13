import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassSelect.css';

export interface GlassSelectItem {
  key: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface GlassSelectProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>,
    GlassExtras {
  items: GlassSelectItem[];
  /** Key of the selected item. */
  value?: string;
  onChange?: (key: string) => void;
  /** Shown when no item is selected. */
  placeholder?: ReactNode;
  disabled?: boolean;
  /** Default `'md'`. */
  size?: 'sm' | 'md' | 'lg';
  /** Content before the value, usually an icon. */
  leading?: ReactNode;
  /** Corner radius px. Default 14. */
  cornerRadius?: number;
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} aria-hidden="true">
      <path d="m5 12.5 5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Glass select: a trigger that opens a styled glass option list. Native
 * `<select>` popups are OS-rendered and cannot be themed, so this is a custom
 * listbox — click/Enter/Space/Arrows open it, arrows move, Enter picks,
 * Esc/Tab or an outside click closes.
 */
export function GlassSelect(props: GlassSelectProps) {
  const {
    items,
    value,
    onChange,
    placeholder = '请选择',
    disabled,
    size = 'md',
    leading,
    cornerRadius = 14,
    className,
    'aria-label': ariaLabel,
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
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [triggerHeight, setTriggerHeight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selected = items.find((item) => item.key === value);
  const enabledItems = items.filter((item) => !item.disabled);

  // The browser clamps a border radius larger than half the height, so a
  // capsule trigger renders with its height/2 radius. Mirror that on the
  // popup instead of reusing the declared (larger) value.
  useEffect(() => {
    const el = rootRef.current?.querySelector<HTMLElement>('.ngs-select-trigger');
    if (!el) return;
    const measure = () => setTriggerHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const popupRadius =
    triggerHeight > 0 ? Math.min(cornerRadius, triggerHeight / 2) : cornerRadius;

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open]);

  const openList = () => {
    if (disabled) return;
    const initial =
      selected && !selected.disabled ? selected.key : (enabledItems[0]?.key ?? null);
    setActiveKey(initial);
    setOpen(true);
  };

  const commit = (key: string) => {
    setOpen(false);
    onChange?.(key);
  };

  const moveActive = (dir: 1 | -1) => {
    if (!enabledItems.length) return;
    const index = enabledItems.findIndex((item) => item.key === activeKey);
    const next =
      index < 0
        ? enabledItems[0]
        : enabledItems[(index + dir + enabledItems.length) % enabledItems.length];
    setActiveKey(next.key);
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveKey(enabledItems[0]?.key ?? null);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveKey(enabledItems[enabledItems.length - 1]?.key ?? null);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (activeKey) commit(activeKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const cls = ['ngs-select', `ngs-select--${size}`, className].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className={cls}
      data-open={open ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-placeholder={selected ? undefined : 'true'}
      {...rest}
    >
      <GlassSurface
        as="button"
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeKey ? `${listId}-${activeKey}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        cornerRadius={cornerRadius}
        className="ngs-select-trigger"
        quality={quality}
        overLight={overLight}
        optics={optics}
        elasticity={elasticity}
        highlightIntensity={highlightIntensity}
        hoverBrightnessBoost={disabled ? 0 : hoverBrightnessBoost}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onTriggerKeyDown}
        onBlur={(e) => {
          if (rootRef.current && !rootRef.current.contains(e.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
      >
        <span className="ngs-select-trigger-inner">
          {leading && (
            <span className="ngs-select-affix" aria-hidden="true">
              {leading}
            </span>
          )}
          <span className="ngs-select-value">{selected ? selected.label : placeholder}</span>
          <span className="ngs-select-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </span>
      </GlassSurface>

      {open && (
        <GlassSurface
          className={`ngs-select-popup ngs-select-popup--${size}`}
          style={{ '--ngs-select-radius': `${popupRadius}px` } as CSSProperties}
          role="listbox"
          id={listId}
          cornerRadius={popupRadius}
          quality={quality}
          overLight={overLight}
          optics={optics}
          elasticity={elasticity}
          highlightIntensity={highlightIntensity}
        >
          <div className="ngs-select-list">
            {items.map((item) => {
              const isSelected = item.key === value;
              const isActive = item.key === activeKey;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  id={`${listId}-${item.key}`}
                  aria-selected={isSelected}
                  aria-disabled={item.disabled || undefined}
                  disabled={item.disabled}
                  tabIndex={-1}
                  className={['ngs-select-option', isActive && 'is-active']
                    .filter(Boolean)
                    .join(' ')}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => {
                    if (!item.disabled) setActiveKey(item.key);
                  }}
                  onClick={() => commit(item.key)}
                >
                  <span className="ngs-select-option-label">{item.label}</span>
                  {isSelected && (
                    <span className="ngs-select-option-check" aria-hidden="true">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </GlassSurface>
      )}
    </div>
  );
}
