import { type HTMLAttributes, type ReactNode } from 'react';
import { GlassSurface, type GlassSurfaceProps } from '../core/GlassSurface';
import './GlassTabBar.css';

type GlassExtras = Pick<
  GlassSurfaceProps,
  'quality' | 'overLight' | 'optics' | 'elasticity' | 'highlightIntensity'
>;

export interface GlassTabBarItem {
  key: string;
  icon?: ReactNode;
  label: ReactNode;
}

export interface GlassTabBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'>,
    GlassExtras {
  items: GlassTabBarItem[];
  activeKey?: string;
  onChange?: (key: string) => void;
}

/**
 * iOS 26 style floating bottom tab bar: a fixed glass capsule centred at the
 * bottom; the active item gets a glass highlight. Override `style` to embed.
 */
export function GlassTabBar(props: GlassTabBarProps) {
  const {
    items,
    activeKey,
    onChange,
    className,
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    ...rest
  } = props;

  return (
    <GlassSurface
      as="nav"
      cornerRadius={999}
      className={['ngs-tabbar', className].filter(Boolean).join(' ')}
      quality={quality}
      overLight={overLight}
      optics={optics}
      elasticity={elasticity}
      highlightIntensity={highlightIntensity}
      {...rest}
    >
      <div className="ngs-tabbar-inner" role="tablist">
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              className={['ngs-tab', active && 'ngs-tab--active'].filter(Boolean).join(' ')}
              onClick={() => onChange?.(item.key)}
            >
              {item.icon && (
                <span className="ngs-tab-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className="ngs-tab-label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </GlassSurface>
  );
}
