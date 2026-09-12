export type BackgroundId = 'aurora' | 'sunset' | 'ocean' | 'text';

export const BACKGROUNDS: { id: BackgroundId; label: string }[] = [
  { id: 'aurora', label: '极光' },
  { id: 'sunset', label: '日落' },
  { id: 'ocean', label: '海洋' },
  { id: 'text', label: '文本' },
];

interface Props {
  id: BackgroundId | 'custom';
  /** data URL for the user-uploaded background. */
  customUrl?: string | null;
}

/** Demo backgrounds (pure CSS presets + user-uploaded image). */
export function BackgroundScene({ id, customUrl }: Props) {
  if (id === 'custom' && customUrl) {
    return (
      <div
        className="bg bg-custom"
        style={{ backgroundImage: `url(${customUrl})` }}
        aria-hidden="true"
      />
    );
  }
  if (id === 'text') {
    return (
      <div className="bg bg-text" aria-hidden="true">
        <div className="bg-text-wall">
          {Array.from({ length: 30 }, (_, i) => (
            <p key={i} className={i % 3 === 1 ? 'dim' : i % 3 === 2 ? 'dimmer' : ''}>
              Liquid Glass 液态玻璃 Refraction 折射 Squircle Snell nico-glass-kit
              Displacement 位移 Rim Light 边缘高光&nbsp;
            </p>
          ))}
        </div>
      </div>
    );
  }
  const preset = id === 'custom' ? 'aurora' : id;
  return (
    <div className={`bg bg-${preset}`} aria-hidden="true">
      {preset === 'aurora' && (
        <>
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
        </>
      )}
      {preset === 'sunset' && <div className="sun" />}
      {preset === 'ocean' && (
        <>
          <div className="glow glow-1" />
          <div className="glow glow-2" />
        </>
      )}
    </div>
  );
}
