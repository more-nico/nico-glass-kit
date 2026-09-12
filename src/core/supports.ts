/**
 * Client-side feature detection, cached after first call.
 * All functions return `false` during SSR (no window/document).
 */

let backdropFilterCache: boolean | null = null;
let svgBackdropFilterCache: boolean | null = null;

const canUseDOM = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined';

/** `backdrop-filter: blur()` (CSS frosted glass, Low tier). */
export function supportsBackdropFilter(): boolean {
  if (!canUseDOM()) return false;
  if (backdropFilterCache !== null) return backdropFilterCache;

  const el = document.createElement('div');
  el.style.backdropFilter = 'blur(2px)';
  let ok = el.style.backdropFilter === 'blur(2px)';
  if (!ok) {
    const style = el.style as CSSStyleDeclaration & { webkitBackdropFilter?: string };
    style.webkitBackdropFilter = 'blur(2px)';
    ok = style.webkitBackdropFilter === 'blur(2px)';
  }
  backdropFilterCache = ok;
  return ok;
}

/**
 * `backdrop-filter: url(#svgFilter)` — SVG displacement refraction.
 * Practically Chromium-only: Firefox and Safari parse the value but do not
 * render SVG filters as backdrop filters, so they are excluded explicitly.
 */
export function supportsSvgBackdropFilter(): boolean {
  if (!canUseDOM()) return false;
  if (svgBackdropFilterCache !== null) return svgBackdropFilterCache;

  const ua = navigator.userAgent;
  const isFirefox = /Firefox\//.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua);
  if (isFirefox || isSafari) {
    svgBackdropFilterCache = false;
    return false;
  }

  const el = document.createElement('div');
  el.style.backdropFilter = 'url(#ngs-supports-test)';
  svgBackdropFilterCache = /url\(/.test(el.style.backdropFilter);
  return svgBackdropFilterCache;
}

/** Test helper: clears cached detection results. */
export function resetSupportsCache(): void {
  backdropFilterCache = null;
  svgBackdropFilterCache = null;
}
