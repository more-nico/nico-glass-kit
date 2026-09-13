import { type HTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassExtras } from '../core/GlassSurface';
import './GlassSegmentedControl.css';

export interface GlassSegmentedItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
}

export interface GlassSegmentedControlProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>,
    GlassExtras {
  items: GlassSegmentedItem[];
  /** Key of the selected segment. */
  value?: string;
  onChange?: (key: string) => void;
  /** Default `'md'`. */
  size?: 'sm' | 'md';
  /** Corner radius px. Default 999. */
  cornerRadius?: number;
}

/**
 * iOS-style segmented picker: a glass capsule whose selected segment carries
 * the `--ngs-active-bg` pill (same active language as GlassTabBar).
 */
export function GlassSegmentedControl(props: GlassSegmentedControlProps) {
  const {
    items,
    value,
    onChange,
    size = 'md',
    cornerRadius = 999,
    className,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    hoverBrightnessBoost,
    ...rest
  } = props;

  const cls = ['ngs-segmented', `ngs-segmented--${size}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <GlassSurface
      cornerRadius={cornerRadius}
      className={cls}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      hoverBrightnessBoost={hoverBrightnessBoost}
      {...rest}
    >
      <div className="ngs-segmented-inner" role="radiogroup">
        {items.map((item) => {
          const active = item.key === value;
          return (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={active}
              className={['ngs-segment', active && 'ngs-segment--active']
                .filter(Boolean)
                .join(' ')}
              onClick={() => onChange?.(item.key)}
            >
              {item.icon && (
                <span className="ngs-segment-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="ngs-segment-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </GlassSurface>
  );
}
