import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlassText } from './GlassText';

describe('GlassText server fallback', () => {
  it('renders readable, escaped text without canvas or a provider', () => {
    const html = renderToStaticMarkup(<GlassText text={'A<&" 09'} />);
    expect(html).toContain('A&lt;&amp;&quot; 09');
    expect(html).not.toContain('data-ngs-text-ready');
    expect(html).not.toContain('ngs-text-tile');
    expect(html).not.toContain('aria-hidden="true">A');
  });

  it('keeps all printable ASCII in the text fallback', () => {
    const text = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    const html = renderToStaticMarkup(<GlassText text={text} />);
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
    expect(html).toContain(escaped);
  });

  it('normalises single-line controls and handles empty text', () => {
    expect(renderToStaticMarkup(<GlassText text={'A\n\t\rB\x00\x7f'} />)).toContain('A   B??');
    expect(renderToStaticMarkup(<GlassText text="" />)).toContain('ngs-text-fallback');
  });
});
