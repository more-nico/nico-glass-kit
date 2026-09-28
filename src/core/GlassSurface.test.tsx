import type { CSSProperties } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlassSurface } from './GlassSurface';

describe('GlassSurface material tint', () => {
  it('forwards tint and strength to the CSS layer in every requested quality tier', () => {
    for (const quality of ['low', 'medium', 'high'] as const) {
      const html = renderToStaticMarkup(
        <GlassSurface quality={quality} optics={{ tint: '#ff0000', tintStrength: 0.65 }} />,
      );
      expect(html).toContain('--ngs-material-tint:#ff0000');
      expect(html).toContain('--ngs-material-tint-strength:0.65');
    }
  });

  it('leaves Auto to the light/dark tokens and forwards zero strength', () => {
    const html = renderToStaticMarkup(<GlassSurface optics={{ tintStrength: 0 }} />);
    expect(html).toContain('--ngs-material-tint:initial');
    expect(html).toContain('--ngs-material-tint-strength:0"');
  });

  it('resets Auto on a nested surface with a dyed parent', () => {
    const html = renderToStaticMarkup(
      <GlassSurface optics={{ tint: '#ff0000' }}><GlassSurface /></GlassSurface>,
    );
    expect(html).toContain('--ngs-material-tint:#ff0000');
    expect(html).toContain('--ngs-material-tint:initial');
  });

  it('retains explicit public CSS tint overrides', () => {
    const html = renderToStaticMarkup(
      <GlassSurface
        optics={{ tint: '#ff0000', tintStrength: 0.65 }}
        style={{ '--ngs-glass-tint': '#0000ff', '--ngs-glass-tint-strength': 0.4 } as CSSProperties}
      />,
    );
    expect(html).toContain('--ngs-glass-tint:#0000ff');
    expect(html).toContain('--ngs-glass-tint-strength:0.4');
  });
});
