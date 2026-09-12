import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTICS } from './optics';

const css = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');

function token(name: string): string {
  const match = new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm').exec(css);
  if (!match) throw new Error(`tokens.css is missing ${name}`);
  return match[1].trim();
}

/** JS-side source of truth for the tint default is a light-dark() colour. */
const LIGHT_DARK = /^light-dark\((.+),\s*(.+)\)$/.exec(DEFAULT_OPTICS.tint);

describe('tokens.css optics defaults', () => {
  it('pins the tint default to the light-dark() halves of DEFAULT_OPTICS', () => {
    expect(LIGHT_DARK).toBeTruthy();
    const [, light, dark] = LIGHT_DARK!;
    expect(token('--ngs-glass-tint')).toBe(dark.trim());
    const lightBlock = css.slice(css.indexOf("[data-ngs-light='true']"));
    expect(lightBlock).toContain(`--ngs-glass-tint: ${light.trim()}`);
  });

  it('pins the tint strength to DEFAULT_OPTICS', () => {
    expect(token('--ngs-glass-tint-strength')).toBe(String(DEFAULT_OPTICS.tintStrength));
  });

  it('does not re-declare optics tokens that no CSS consumes', () => {
    for (const name of [
      '--ngs-glass-blur',
      '--ngs-glass-saturation',
      '--ngs-glass-brightness',
      '--ngs-lens-refraction',
      '--ngs-lens-depth',
      '--ngs-lens-curvature',
      '--ngs-lens-dispersion',
    ]) {
      expect(css).not.toContain(name);
    }
  });
});
