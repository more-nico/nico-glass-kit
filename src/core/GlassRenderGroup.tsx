import {
  createContext, forwardRef, useContext, useLayoutEffect, useEffect, useRef, useState,
  type HTMLAttributes, type MutableRefObject,
} from 'react';
import type { GlassFilterSpec } from './SvgFilterRegistry';
import type { GlassGlyphShape } from './GlassSurface';
import { createLensFilter, lensChannelMatrix, lensSaturationMatrix } from './lensFilter';
import { observeResize } from './observeResize';
import { batchBounds, boxesOverlap, packRenderBatches, type BatchBox } from './renderBatch';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ATLAS_BUDGET = 32 * 1024 * 1024;
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
let nextGroup = 0;
let connectedGroups = 0;
let maskEpoch = 0;

interface RenderMember {
  readonly el: HTMLElement | null;
  readonly effect: HTMLElement | null;
  readonly backdrop: string;
  readonly spec: GlassFilterSpec | null;
  readonly glyph: GlassGlyphShape | null;
  readonly radius: number;
  readonly raster: number;
  readonly active: boolean;
}
type BatchedEffect = HTMLElement & { __ngsBatchFilter?: string };
interface Row extends BatchBox {
  member: RenderMember;
  spec: GlassFilterSpec;
  radius: number;
  mask: string;
  raster: number;
}
interface Tile {
  rows: Row[];
  atlasRows: Row[];
  box: BatchBox;
  layer: HTMLElement;
  filter: SVGFilterElement;
  mask: SVGMaskElement;
  holes: Map<RenderMember, SVGElement>;
  url: string;
  bytes: number;
  paintedKey?: string;
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function opticsKey(spec: GlassFilterSpec, raster: number): string {
  return [spec.blur, spec.saturation, spec.brightness, spec.dispersion, spec.scale, raster].join('|');
}

/** Same descriptor and alpha semantics as individual surfaces. */
function paintFilter(filter: SVGFilterElement, spec: GlassFilterSpec): void {
  const descriptor = createLensFilter({ ...spec, animateBrightness: true });
  const pad = descriptor.regionPaddingPx;
  const region = { x: `${-pad / spec.width * 100}%`, y: `${-pad / spec.height * 100}%`,
    width: `${100 + 2 * pad / spec.width * 100}%`, height: `${100 + 2 * pad / spec.height * 100}%` };
  for (const [name, value] of Object.entries(region)) if (filter.getAttribute(name) !== value) filter.setAttribute(name, value);
  const nodes: SVGElement[] = [svgElement('feImage', {
    href: spec.mapUrl, x: 0, y: 0, width: spec.width, height: spec.height,
    preserveAspectRatio: 'none', result: 'map',
  })];
  for (const pass of descriptor.passes) {
    const attrs: Record<string, string | number> = { in: pass.input };
    if (pass.result) attrs.result = pass.result;
    switch (pass.type) {
      case 'blur': nodes.push(svgElement('feGaussianBlur', { ...attrs, stdDeviation: pass.sigma })); break;
      case 'saturate': nodes.push(svgElement('feColorMatrix', { ...attrs, type: 'matrix', values: lensSaturationMatrix(pass.amount) })); break;
      case 'brightness': {
        const node = svgElement('feComponentTransfer', attrs);
        for (const channel of ['feFuncR', 'feFuncG', 'feFuncB'] as const) {
          node.append(svgElement(channel, { type: 'linear', slope: pass.amount, intercept: 0 }));
        }
        nodes.push(node); break;
      }
      case 'displacement': nodes.push(svgElement('feDisplacementMap', {
        ...attrs, in2: pass.map, scale: pass.scale, xChannelSelector: 'R', yChannelSelector: 'G',
      })); break;
      case 'channel': nodes.push(svgElement('feColorMatrix', { ...attrs, type: 'matrix', values: lensChannelMatrix(pass.channel) })); break;
      case 'blend': nodes.push(svgElement('feBlend', { ...attrs, in2: pass.input2, mode: pass.mode })); break;
    }
  }
  // Keep matching primitives and their decoded image alive while retuning.
  if (filter.children.length === nodes.length && nodes.every((node, i) => node.tagName === filter.children[i].tagName)) {
    nodes.forEach((node, i) => {
      const old = filter.children[i];
      for (const attr of [...node.attributes]) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
      for (let c = 0; c < node.children.length; c++) {
        for (const attr of [...node.children[c].attributes]) {
          if (old.children[c].getAttribute(attr.name) !== attr.value) old.children[c].setAttribute(attr.name, attr.value);
        }
      }
    });
  } else filter.replaceChildren(...nodes);
}

function imageFor(url: string, images: Map<string, Promise<HTMLImageElement>>): Promise<HTMLImageElement> {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        image.onload = image.onerror = null;
        const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
        decoded.then(() => resolve(image), reject);
      };
      image.onerror = () => { image.onload = image.onerror = null; reject(new Error('Glass atlas image unavailable')); };
      image.src = url;
    });
    images.set(url, pending);
  }
  return pending;
}

function blobFor(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Glass atlas encoding unavailable')), 'image/png'));
}

function sameShape(a: Row, b: Row): boolean {
  return a.member === b.member && a.x === b.x && a.y === b.y && a.width === b.width &&
    a.height === b.height && a.radius === b.radius && a.mask === b.mask &&
    a.raster === b.raster && a.spec.mapUrl === b.spec.mapUrl;
}

const maskBounds = new Map<string, BatchBox | null>();
const pendingMasks = new Map<string, Promise<BatchBox>>();

function trimMaskBounds(): void {
  let bytes = [...maskBounds.keys()].reduce((sum, key) => sum + key.length * 2, 0);
  while (maskBounds.size > 32 || bytes > 8 * 1024 * 1024) {
    const oldest = maskBounds.keys().next().value;
    if (oldest === undefined) break;
    bytes -= oldest.length * 2; maskBounds.delete(oldest);
  }
}

async function glyphBounds(url: string): Promise<BatchBox> {
  const cached = maskBounds.get(url);
  if (cached) return cached;
  const pending = pendingMasks.get(url);
  if (pending) return pending;
  const epoch = maskEpoch;
  const task = (async () => {
    const image = await imageFor(url, new Map());
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 4 * 1024 * 1024) throw new Error('Glyph bounds exceed pixel budget');
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Glyph bounds unavailable');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = 0, bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (!pixels[(y * canvas.width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
    const bounds = { x: left / canvas.width, y: top / canvas.height,
      width: Math.max(0, right - left) / canvas.width, height: Math.max(0, bottom - top) / canvas.height };
    if (epoch !== maskEpoch) return bounds;
    maskBounds.set(url, bounds);
    trimMaskBounds();
    return bounds;
  })();
  pendingMasks.set(url, task);
  try { return await task; } catch (error) {
    if (epoch === maskEpoch) { maskBounds.set(url, null); trimMaskBounds(); }
    throw error;
  } finally { if (pendingMasks.get(url) === task) pendingMasks.delete(url); }
}

function safeTransform(cs: CSSStyleDeclaration, translation: boolean): boolean {
  if (cs.scale && cs.scale !== 'none' && cs.scale.split(' ').some(value => Number(value) !== 1)) return false;
  if (cs.rotate && cs.rotate !== 'none' && !/^0(?:deg|rad|grad|turn)?$/.test(cs.rotate)) return false;
  if (cs.zoom && cs.zoom !== 'normal' && Number(cs.zoom) !== 1) return false;
  if (cs.perspective !== 'none') return false;
  if (!translation && cs.translate && cs.translate !== 'none' && cs.translate.split(' ').some(value => parseFloat(value) !== 0)) return false;
  const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
  if (!translation) return m.isIdentity;
  return m.m11 === 1 && m.m22 === 1 && m.m33 === 1 && m.m44 === 1 &&
    m.m12 === 0 && m.m13 === 0 && m.m14 === 0 && m.m21 === 0 && m.m23 === 0 && m.m24 === 0 &&
    m.m31 === 0 && m.m32 === 0 && m.m34 === 0;
}

const LAYOUT_PROPERTY = /^(width|height|minWidth|maxWidth|minHeight|maxHeight|margin.*|padding.*|left|right|top|bottom|inset.*|flex.*|grid.*|gap|rowGap|columnGap|fontSize|lineHeight)$/;
const GEOMETRY_PROPERTY = /^(transform|scale|rotate|translate|opacity|filter|visibility|width|height|minWidth|maxWidth|minHeight|maxHeight|margin.*|padding.*|left|right|top|bottom|inset.*|flex.*|grid.*|gap|rowGap|columnGap|fontSize|lineHeight|clipPath|maskImage|offsetPath|offsetDistance)$/;
function hasGeometryAnimation(el: Element, properties = GEOMETRY_PROPERTY): boolean {
  return el.getAnimations().some(animation => {
    if (animation.playState !== 'running' && animation.playState !== 'paused' && !animation.pending) return false;
    const effect = animation.effect as KeyframeEffect | null;
    return !effect?.getKeyframes || effect.getKeyframes().some(frame => Object.keys(frame).some(key => properties.test(key)));
  });
}

/** A group never moves a painted wrapper or another backdrop root into a batch. */
function eligible(el: HTMLElement, root: HTMLElement): boolean {
  if (el.parentElement?.closest('.ngs-surface') !== root.parentElement?.closest('.ngs-surface')) return false;
  for (let node: HTMLElement | null = el; node && node !== root; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (!safeTransform(cs, false) || cs.visibility !== 'visible' || cs.contentVisibility !== 'visible' || hasGeometryAnimation(node) || cs.opacity !== '1' || cs.filter !== 'none' ||
      cs.position === 'fixed' || cs.position === 'sticky' || cs.mixBlendMode !== 'normal' ||
      cs.clipPath !== 'none' || cs.maskImage !== 'none' || cs.zIndex !== 'auto') return false;
    if (node === el && [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].some(value => parseFloat(value) > 0)) return false;
    if (node === el && (cs.backgroundImage !== 'none' || !/^(transparent|rgba\([^)]*,\s*0\))$/.test(cs.backgroundColor))) return false;
    if (node === el && ([cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius,
      cs.borderBottomRightRadius].some(radius => radius !== cs.borderTopLeftRadius) || !/^\d+(\.\d+)?px$/.test(cs.borderTopLeftRadius))) return false;
    if (node !== el && (cs.backdropFilter !== 'none' || cs.backgroundImage !== 'none' ||
      !/^(transparent|rgba\([^)]*,\s*0\))$/.test(cs.backgroundColor) ||
      cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) return false;
  }
  for (const layer of el.querySelectorAll<HTMLElement>(':scope > .ngs-motion, :scope > .ngs-motion > .ngs-effect')) {
    const cs = getComputedStyle(layer);
    if (!safeTransform(cs, false) || cs.opacity !== '1' || cs.filter !== 'none' || cs.visibility !== 'visible' ||
      hasGeometryAnimation(layer)) return false;
  }
  return true;
}

class GroupRenderer {
  private root: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private defs: SVGDefsElement | null = null;
  private members = new Set<RenderMember>();
  private tiles: Tile[] = [];
  private resize = new Map<RenderMember, () => void>();
  private observer: MutationObserver | null = null;
  private ancestorObserver: MutationObserver | null = null;
  private motions = new Map<Element, RegExp>();
  private parent: GroupRenderer | null = null;
  private descendantActivity = new Set<GroupRenderer>();
  private layerStyles = new WeakMap<Element, string>();
  private pressed = false;
  private intersection: IntersectionObserver | null = null;
  private near = new Map<RenderMember, boolean>();
  private pending = false;
  private revision = 0;
  private serial = 0;
  private namespace = '';
  private connected = false;

  connect(root: HTMLElement, host: HTMLElement, defs: SVGDefsElement, parent: GroupRenderer | null): void {
    this.connected = true; connectedGroups++;
    this.root = root; this.host = host; this.defs = defs;
    this.parent = parent;
    this.parent?.setDescendantActive(this, [...this.members].some(member => member.active));
    for (const source of this.descendantActivity) this.parent?.setDescendantActive(source, true);
    this.namespace = `ngs-batch-${++nextGroup}`;
    this.observer = new MutationObserver(records => {
      if (records.some(record => {
        const node = record.target instanceof Element ? record.target : record.target.parentElement;
        if (node?.closest('[data-ngs-internal="all"]')) return false;
        if (record.type === 'attributes' && ['data-ngs-individual-filter', 'data-ngs-render-batched',
          'data-ngs-render-batches', 'data-ngs-render-members'].includes(record.attributeName ?? '')) return false;
        if (record.type === 'attributes' && record.attributeName === 'style' && node instanceof HTMLElement && node.dataset.ngsInternal === 'style') {
          const member = [...this.members].find(member => member.el === node.closest('.ngs-surface'));
          // Nested groups report activity at its start/end. Their own spring
          // frames do not require a full ancestor geometry/atlas replan.
          if (!member && node.closest('.ngs-render-group') !== root) return false;
          if (member?.active && node.classList.contains('ngs-motion')) return false;
          const style = node.style;
          const signature = [style.transform, style.scale, style.rotate, style.translate, style.opacity, style.filter, style.visibility].join('|');
          const previous = this.layerStyles.get(node); this.layerStyles.set(node, signature);
          return previous !== signature;
        }
        return true;
      })) this.changed();
    });
    this.observer.observe(root, { subtree: true, childList: true, attributes: true });
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersection = new IntersectionObserver(entries => {
        for (const entry of entries) for (const member of this.members) {
          if (member.el === entry.target) this.near.set(member, entry.isIntersecting);
        }
        this.changed();
      }, { rootMargin: '100% 0px' });
      for (const member of this.members) if (member.el) this.intersection.observe(member.el);
    }
    this.ancestorObserver = new MutationObserver(this.changed);
    for (let node = root.parentElement; node; node = node.parentElement) this.ancestorObserver.observe(node, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    for (const event of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) window.addEventListener(event, this.motionEvent, true);
    root.addEventListener('keydown', this.keyDown, true);
    window.addEventListener('keyup', this.keyUp, true);
    window.addEventListener('blur', this.keyUp);
    window.addEventListener('resize', this.changed);
    this.changed();
  }

  disconnect(): void {
    this.revision++;
    if (this.connected) { this.connected = false; connectedGroups--; }
    this.observer?.disconnect(); this.observer = null;
    this.intersection?.disconnect(); this.intersection = null;
    this.ancestorObserver?.disconnect(); this.ancestorObserver = null;
    for (const event of ['transitionrun', 'transitionend', 'transitioncancel', 'animationstart', 'animationend', 'animationcancel']) window.removeEventListener(event, this.motionEvent, true);
    this.root?.removeEventListener('keydown', this.keyDown, true);
    window.removeEventListener('keyup', this.keyUp, true);
    window.removeEventListener('blur', this.keyUp);
    this.motions.clear(); this.pressed = false;
    this.parent?.setDescendantActive(this, false);
    for (const source of this.descendantActivity) this.parent?.setDescendantActive(source, false);
    this.descendantActivity.clear(); this.parent = null;
    window.removeEventListener('resize', this.changed);
    for (const tile of this.tiles) this.destroy(tile);
    this.tiles = [];
    this.root = this.host = this.defs = null;
    this.near.clear();
    if (!connectedGroups) { maskEpoch++; maskBounds.clear(); pendingMasks.clear(); }
  }

  private suspend(): void {
    this.revision++;
    for (const member of this.members) this.detach(member);
    this.updateStats();
  }

  private setDescendantActive(source: GroupRenderer, active: boolean): void {
    if (this.descendantActivity.has(source) === active) return;
    if (active) { this.descendantActivity.add(source); this.suspend(); }
    else this.descendantActivity.delete(source);
    this.parent?.setDescendantActive(source, active);
    this.changed();
  }

  activityChanged = (member: RenderMember): void => {
    if (member.active) this.detach(member);
    this.parent?.setDescendantActive(this, [...this.members].some(item => item.active));
    this.changed();
  };

  private keyDown = (event: KeyboardEvent): void => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input, textarea, select, [contenteditable]')) return;
    const surface = target.closest('.ngs-surface');
    if (![...this.members].some(member => member.el === surface)) return;
    this.pressed = true; this.suspend();
  };
  private keyUp = (): void => {
    if (!this.pressed) return;
    this.pressed = false; this.changed();
  };
  private motionEvent = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || !this.root ||
      !(this.root.contains(target) || target.contains(this.root))) return;
    if (target.closest('[data-ngs-internal="all"]')) return;
    // A spinner or an animated icon retained in the content layer does not
    // move the backdrop. Only surface ancestors/effect layers, or animations
    // that can change layout, suspend shared rendering.
    const movesBackdrop = [...this.members].some(member => member.el &&
      (target.contains(member.el) || target === member.effect || target === member.effect?.parentElement));
    if (!movesBackdrop && !this.motions.has(target) && !hasGeometryAnimation(target, LAYOUT_PROPERTY)) return;
    const transition = event as TransitionEvent;
    if (event.type.startsWith('transition') && !/^(transform|scale|rotate|translate|opacity|filter|visibility|width|height|min-width|max-width|min-height|max-height|.*margin.*|.*padding.*|left|right|top|bottom|inset.*|flex.*|grid.*|.*gap|font-size|line-height)$/.test(transition.propertyName)) return;
    if (event.type === 'animationstart' && !hasGeometryAnimation(target)) return;
    this.motions.set(target, movesBackdrop ? GEOMETRY_PROPERTY : LAYOUT_PROPERTY);
    if (event.type === 'transitionrun' || event.type === 'animationstart') this.suspend();
    this.changed();
  };

  register = (member: RenderMember): (() => void) => {
    this.members.add(member);
    if (member.el) {
      this.resize.set(member, observeResize(member.el, this.changed));
      this.intersection?.observe(member.el);
    }
    this.changed();
    return () => {
      this.detach(member);
      this.members.delete(member);
      this.parent?.setDescendantActive(this, [...this.members].some(item => item.active));
      if (member.el) this.intersection?.unobserve(member.el);
      this.resize.get(member)?.(); this.resize.delete(member); this.near.delete(member);
      this.changed();
    };
  };

  detach = (member: RenderMember): void => {
    for (const tile of this.tiles) {
      const hole = tile.holes.get(member);
      if (hole && hole.getAttribute('display') !== 'none') hole.setAttribute('display', 'none');
    }
    const effect = member.effect;
    if (effect?.dataset.ngsRenderBatched === 'true') {
      // Restore React's current intent, including a newly selected Low tier.
      // React may not rewrite a value which is unchanged in its virtual tree.
      effect.style.backdropFilter = member.backdrop;
      delete (effect as BatchedEffect).__ngsBatchFilter;
      delete effect.dataset.ngsRenderBatched;
    }
  };

  changed = (): void => {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      if (this.root && this.host && this.defs) void this.refresh();
    });
  };

  private destroy(tile: Tile): void {
    for (const row of tile.rows) this.detach(row.member);
    tile.layer.remove(); tile.filter.remove(); tile.mask.remove();
    URL.revokeObjectURL(tile.url);
  }

  private async refresh(): Promise<void> {
    const root = this.root!, host = this.host!, defs = this.defs!;
    const revision = ++this.revision;
    for (const [target, properties] of this.motions) if (!target.isConnected || !hasGeometryAnimation(target, properties)) this.motions.delete(target);
    if (this.pressed || this.motions.size || this.descendantActivity.size) { this.suspend(); return; }
    for (let node: HTMLElement | null = root; node; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (!safeTransform(cs, true) || cs.visibility !== 'visible' || cs.contentVisibility !== 'visible') {
        this.suspend(); return;
      }
    }
    if (getComputedStyle(root).position === 'static') {
      for (const tile of this.tiles) this.destroy(tile);
      this.tiles = []; this.updateStats(); return;
    }
    const base = root.getBoundingClientRect();
    const rows: Row[] = [];
    const obstacles = new Map<RenderMember, BatchBox>();
    for (const member of this.members) {
      const el = member.el, spec = member.spec;
      if (!el || !root.contains(el)) { this.detach(member); continue; }
      const box = el.getBoundingClientRect();
      const position: BatchBox = { x: box.left - base.left - root.clientLeft + root.scrollLeft,
        y: box.top - base.top - root.clientTop + root.scrollTop, width: box.width, height: box.height };
      obstacles.set(member, position);
      if (!spec || member.active || !eligible(el, root) || !box.width || !box.height) { this.detach(member); continue; }
      if (member.glyph) {
        if (member.glyph.maskUrl.length * 2 > 8 * 1024 * 1024) { this.detach(member); continue; }
        const bounds = maskBounds.get(member.glyph.maskUrl);
        if (bounds === null) { this.detach(member); continue; }
        if (!bounds) {
          const missing = member.glyph.maskUrl;
          void glyphBounds(missing).then(() => { if (this.members.has(member) && member.glyph?.maskUrl === missing) this.changed(); }).catch(() => {});
          this.detach(member); continue;
        }
        const guard = 1 / member.raster;
        position.coverage = { x: position.x + bounds.x * box.width - guard, y: position.y + bounds.y * box.height - guard,
          width: bounds.width * box.width + guard * 2, height: bounds.height * box.height + guard * 2 };
      }

      rows.push({ member, spec, ...position, radius: Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius), box.width / 2, box.height / 2),
        mask: member.glyph?.maskUrl ?? '', raster: member.raster });
    }
    // Reject overlap against every registered surface, including a surface
    // of a different material. Their original paint order must be retained.
    const memberElements = new Set([...this.members].map(member => member.el));
    const foreign = [...document.querySelectorAll<HTMLElement>('.ngs-surface')]
      .filter(el => !memberElements.has(el) && !el.contains(root))
      .map(el => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left - base.left - root.clientLeft + root.scrollLeft,
          y: rect.top - base.top - root.clientTop + root.scrollTop, width: rect.width, height: rect.height };
      }).filter(box => box.width && box.height);
    const safe = rows.filter(row => !foreign.some(other => boxesOverlap(row.coverage ?? row, other)) &&
      ![...obstacles].some(([member, other]) => row.member !== member && boxesOverlap(row.coverage ?? row, other.coverage ?? other)));
    const cohorts = new Map<string, Row[]>();
    for (const row of safe) {
      const key = opticsKey(row.spec, row.raster);
      const list = cohorts.get(key) ?? []; list.push(row); cohorts.set(key, list);
    }
    const planned = [...cohorts.values()].flatMap(packRenderBatches).filter(group => group.length > 1);
    const keep = new Set<Tile>();
    const reuse: Array<{ tile: Tile; rows: Row[] }> = [];
    const build: Row[][] = [];
    for (const group of planned) {
      const old = this.tiles.find(tile => !keep.has(tile) && group.every(row => tile.atlasRows.some(previous => sameShape(previous, row))));
      if (old) { keep.add(old); reuse.push({ tile: old, rows: group }); }
      else if (group.some(row => this.near.get(row.member) ?? (
        row.y + base.top + row.height > -innerHeight && row.y + base.top < innerHeight * 2))) build.push(group);
    }
    // Finish every teardown before covering any reassigned member. detach()
    // hides holes in all atlases, including a tile selected for reuse.
    for (const tile of this.tiles) if (!keep.has(tile)) this.destroy(tile);
    for (const { tile, rows } of reuse) for (const previous of tile.rows) {
      if (!rows.some(row => row.member === previous.member)) this.detach(previous.member);
    }
    this.tiles = this.tiles.filter(tile => keep.has(tile));
    for (const { tile, rows } of reuse) {
      tile.rows = rows;
      const key = opticsKey(rows[0].spec, rows[0].raster);
      if (tile.paintedKey !== key) {
        paintFilter(tile.filter, { ...rows[0].spec, mapUrl: tile.url, width: tile.box.width, height: tile.box.height });
        tile.paintedKey = key;
      }
      for (const row of rows) this.cover(tile, row.member);
    }
    this.updateStats();
    const images = new Map<string, Promise<HTMLImageElement>>();
    for (const group of build) {
      if (revision !== this.revision || !this.root) return;
      const box = batchBounds(group);
      const raster = group[0].raster;
      const width = Math.max(1, Math.round(box.width * raster));
      const height = Math.max(1, Math.round(box.height * raster));
      const bytes = width * height * 4;
      if (bytes + this.tiles.reduce((sum, tile) => sum + tile.bytes, 0) > ATLAS_BUDGET) continue;
      let url: string | null = null;
      try {
        const sources = await Promise.all(group.map(row => imageFor(row.spec.mapUrl, images)));
        if (revision !== this.revision || !this.root) return;
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) continue;
        ctx.fillStyle = 'rgb(128 128 128)'; ctx.fillRect(0, 0, width, height);
        ctx.scale(width / box.width, height / box.height);
        group.forEach((row, i) => {
          ctx.save();
          if (row.coverage) {
            const area = row.coverage;
            ctx.beginPath(); ctx.rect(area.x - box.x, area.y - box.y, area.width, area.height); ctx.clip();
          }
          ctx.drawImage(sources[i], row.x - box.x, row.y - box.y, row.width, row.height);
          ctx.restore();
        });
        const blob = await blobFor(canvas);
        if (revision !== this.revision || !this.root) return;
        url = URL.createObjectURL(blob);
        await imageFor(url, images); // Never expose an undecoded atlas.
        if (revision !== this.revision || !this.root || this.pressed || this.motions.size || this.descendantActivity.size || group.some(row => row.member.active)) { URL.revokeObjectURL(url); continue; }
        const id = `${this.namespace}-${++this.serial}`;
        const filter = svgElement('filter', { id, 'color-interpolation-filters': 'sRGB' });
        paintFilter(filter, { ...group[0].spec, mapUrl: url, width: box.width, height: box.height });
        const mask = svgElement('mask', { id: `${id}-mask`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: box.width, height: box.height, 'mask-type': 'alpha' });
        const holes = new Map<RenderMember, SVGElement>();
        for (const row of group) {
          const attrs = { x: row.x - box.x, y: row.y - box.y, width: row.width, height: row.height };
          const node = row.mask ? svgElement('image', { ...attrs, href: row.mask, preserveAspectRatio: 'none' })
            : svgElement('rect', { ...attrs, rx: row.radius, fill: 'white' });
          mask.append(node); holes.set(row.member, node);
        }
        defs.append(filter, mask);
        const layer = document.createElement('span');
        layer.className = 'ngs-render-layer';
        Object.assign(layer.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`,
          backdropFilter: `url(#${id})`, maskImage: `url(#${id}-mask)` });
        host.append(layer);
        const tile: Tile = { rows: group, atlasRows: group, box, layer, filter, mask, holes, url, bytes };
        this.tiles.push(tile);
        for (const row of group) this.cover(tile, row.member);
        this.updateStats();
      } catch {
        if (url) URL.revokeObjectURL(url);
        // Encoding/CSP/image failures keep the already functioning private path.
      }
    }
  }

  private cover(tile: Tile, member: RenderMember): void {
    const effect = member.effect;
    if (!effect || member.active || this.pressed || this.motions.size || this.descendantActivity.size) return;
    const hole = tile.holes.get(member);
    if (hole?.hasAttribute('display')) hole.removeAttribute('display');
    if (effect.style.backdropFilter !== 'none') effect.style.backdropFilter = 'none';
    (effect as BatchedEffect).__ngsBatchFilter = tile.filter.id;
    if (effect.dataset.ngsRenderBatched !== 'true') effect.dataset.ngsRenderBatched = 'true';
  }

  private updateStats(): void {
    if (!this.root) return;
    const active = this.tiles.map(tile => tile.rows.filter(row => (row.member.effect as BatchedEffect | null)?.__ngsBatchFilter === tile.filter.id));
    const count = String(active.filter(rows => rows.length).length);
    const members = String(active.reduce((sum, rows) => sum + rows.length, 0));
    if (this.root.dataset.ngsRenderBatches !== count) this.root.dataset.ngsRenderBatches = count;
    if (this.root.dataset.ngsRenderMembers !== members) this.root.dataset.ngsRenderMembers = members;
  }
}

const RenderGroupContext = createContext<GroupRenderer | null>(null);

/** Internal opt-in inheritance for the inline glyph renderer. */
export function useGlassRenderGroupEnabled(): boolean {
  return useContext(RenderGroupContext) !== null;
}

export interface GlassRenderGroupProps extends HTMLAttributes<HTMLElement> {
  /** Wrapper element. Defaults to div; span supports inline glyph layouts. */
  as?: 'div' | 'span';
  /** Opt in to spatially batched glass rendering. Default true. */
  enabled?: boolean;
}

/** Combines compatible, disjoint glass surfaces without changing their optics. */
export const GlassRenderGroup = forwardRef<HTMLElement, GlassRenderGroupProps>(function GlassRenderGroup(
  { as: Comp = 'div', enabled = true, children, className, ...rest }, forwardedRef,
) {
  const parent = useContext(RenderGroupContext);
  const [renderer] = useState(() => new GroupRenderer());
  const root = useRef<HTMLElement | null>(null);
  const host = useRef<HTMLSpanElement | null>(null);
  const defs = useRef<SVGDefsElement | null>(null);
  useClientLayoutEffect(() => {
    if (!enabled || !root.current || !host.current || !defs.current) return;
    renderer.connect(root.current, host.current, defs.current, parent);
    return () => renderer.disconnect();
  }, [renderer, enabled, parent]);
  return <RenderGroupContext.Provider value={enabled ? renderer : null}>
    <Comp {...rest} className={['ngs-render-group', className].filter(Boolean).join(' ')} ref={node => {
      root.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}>
      <span className="ngs-render-host" data-ngs-internal="all" aria-hidden="true" ref={host} />
      {children}
      <svg width="0" height="0" className="ngs-render-defs" data-ngs-internal="all" aria-hidden="true"><defs ref={defs} /></svg>
    </Comp>
  </RenderGroupContext.Provider>;
});

export function useGlassRenderMember(options: {
  element: MutableRefObject<HTMLElement | null>;
  effect: MutableRefObject<HTMLDivElement | null>;
  spec: MutableRefObject<GlassFilterSpec | null>;
  filterId: string | null;
  backdrop: string;
  glyph: GlassGlyphShape | null;
  radius: number;
  raster: number;
}): (reason: string, active: boolean) => void {
  const renderer = useContext(RenderGroupContext);
  const latest = useRef(options); latest.current = options;
  const reasons = useRef(new Set<string>());
  const [member] = useState<RenderMember>(() => ({
    get el() { return latest.current.element.current; },
    get effect() { return latest.current.effect.current; },
    get backdrop() { return latest.current.backdrop; },
    get spec() { return latest.current.spec.current; },
    get glyph() { return latest.current.glyph; },
    get radius() { return latest.current.radius; },
    get raster() { return latest.current.raster; },
    get active() { return reasons.current.size > 0; },
  }));
  useClientLayoutEffect(() => renderer?.register(member), [renderer, member]);
  const lastSignature = useRef<unknown[]>([]);
  useClientLayoutEffect(() => {
    const signature = [options.effect.current, options.filterId, options.spec.current?.key, options.backdrop, options.glyph?.key, options.radius, options.raster];
    const changed = signature.some((value, i) => value !== lastSignature.current[i]);
    lastSignature.current = signature;
    const effect = options.effect.current;
    if (effect) {
      if (options.filterId) {
        if (effect.dataset.ngsIndividualFilter !== options.filterId) effect.dataset.ngsIndividualFilter = options.filterId;
      } else delete effect.dataset.ngsIndividualFilter;
    }
    if (changed) renderer?.changed();
  });
  const rendererRef = useRef(renderer); rendererRef.current = renderer;
  const [setActive] = useState(() => (reason: string, active: boolean) => {
    if (reasons.current.has(reason) === active) return;
    if (active) reasons.current.add(reason);
    else reasons.current.delete(reason);
    rendererRef.current?.activityChanged(member);
  });
  return setActive;
}
