import { expect, it, vi } from 'vitest';
import { clearGlyphRasterCache, generateGlyphRaster, type GlyphRasterOptions } from './glyphLensMap';
import { resetGlyphRasterWorkerPool, submitGlyphRasterJob } from './rasterWorkerPool';
import type { RasterWorkerOutput, RasterWorkerRunMessage } from './rasterWorkerProtocol';

const jobs = vi.hoisted(() => [] as Array<{
  message: RasterWorkerRunMessage;
  reply: (output: RasterWorkerOutput) => void;
}>);

vi.mock('./rasterWorker?worker&inline', () => ({
  default: class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage(message: RasterWorkerRunMessage) {
      jobs.push({ message, reply: output => this.onmessage?.({
        data: { type: 'done', jobId: message.jobId, revision: message.revision, output },
      } as MessageEvent) });
    }
    terminate() {}
  },
}));

it('rejects old-font work after a cache clear even when glyph metrics match', () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {});
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('OffscreenCanvas', class {});
  const options: GlyphRasterOptions = {
    char: 'G', font: '16px Arial', width: 4, height: 4, penX: 0, baseline: 3,
    depth: 1, curvature: 0.49, refraction: 0.5, dpr: 1, rasterScale: 0.5,
  };
  const delivered = vi.fn();
  const failed = vi.fn();
  const submit = (revision: number) => submitGlyphRasterJob('font-swap', revision, [{
    options, coverage: new Uint8ClampedArray(16).fill(revision),
  }], delivered, failed);
  const reply = (index: number, maskUrl: string) => {
    const { input } = jobs[index].message;
    if (input.kind !== 'glyph') throw new Error('Expected a glyph job');
    jobs[index].reply({ kind: 'glyph', glyphs: input.glyphs.map(glyph => ({
      index: glyph.index, key: glyph.key, pixelWidth: 4, pixelHeight: 4,
      maskUrl, ringUrl: 'ring', glintUrl: 'glint', mapUrl: 'map',
      scale: 1, edgeUsed: 1, maxInside: 1,
    })) });
  };
  try {
    submit(1);
    clearGlyphRasterCache();
    submit(2);
    reply(0, 'old-font');
    expect(delivered).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(2);
    const latest = jobs[1].message.input;
    expect(latest.kind === 'glyph' && latest.glyphs[0].coverage[0]).toBe(2);
    reply(1, 'loaded-font');
    expect(failed).not.toHaveBeenCalled();
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledWith(2, [expect.objectContaining({ maskUrl: 'loaded-font' })], 'worker');
    expect(generateGlyphRaster(options)?.maskUrl).toBe('loaded-font');
  } finally {
    resetGlyphRasterWorkerPool();
    clearGlyphRasterCache();
    vi.unstubAllGlobals();
  }
});
