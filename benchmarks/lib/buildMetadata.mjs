import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function readURL(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const get = parsed.protocol === 'http:' ? httpGet : parsed.protocol === 'https:' ? httpsGet : null;
    if (!get) { reject(new Error('Build metadata requires HTTP(S)')); return; }
    const request = get(parsed, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 4) {
        response.resume(); resolve(readURL(new URL(response.headers.location, parsed), redirects + 1)); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode}`)); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 32 * 1024 * 1024) { request.destroy(new Error('Build asset exceeds 32 MiB')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(15000, () => request.destroy(new Error('Build metadata timed out')));
    request.on('error', reject);
  });
}
/** Direct HTTP is intentional: Node fetch treats the local preview port 4190
 * as a forbidden Sieve port. Browser navigation and this explicit harness URL
 * are valid; using http keeps metadata collection independent of fetch policy. */
export async function fetchBuildMetadata(url) {
  try {
    const bytes = await readURL(url), html = bytes.toString('utf8'), base = new URL(url);
    const references = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)].map(match => match[1]).filter(reference => !/^data:/i.test(reference));
    const hash = createHash('sha256'); hash.update(html);
    const assets = [];
    for (const reference of [...new Set(references)].sort()) {
      const asset = new URL(reference, url);
      if (asset.origin !== base.origin) continue;
      const content = await readURL(asset.href);
      hash.update(asset.pathname); hash.update(content);
      assets.push({ path: asset.pathname, bytes: content.length, sha256: digest(content) });
    }
    return { url, hash: hash.digest('hex'), htmlSha256: digest(html), assetCount: assets.length, assets, error: null };
  } catch (error) {
    return { url, hash: null, htmlSha256: null, assetCount: null, assets: null, error: error.message };
  }
}
