import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_CACHE_BYTES = 500 * 1024 * 1024;

const STAGE_FIELDS = {
  create: (cfg) => pick(cfg, ['shapes', 'operations', 'parts', 'assembly', 'export']),
  drawing: (cfg) => pick(cfg, ['shapes', 'operations', 'parts', 'assembly', 'export', 'drawing', 'drawing_plan', 'tolerance', 'dxfExport']),
  dfm: (cfg) => pick(cfg, ['shapes', 'operations', 'manufacturing', 'shop_profile']),
  cost: (cfg) => pick(cfg, ['shapes', 'operations', 'material', 'process', 'batch_size', 'shop_profile', 'dfm_score']),
  tolerance: (cfg) => pick(cfg, ['parts', 'assembly', 'tolerance']),
};

function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

function stableStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => JSON.stringify(key) + ':' + stableStringify(obj[key])).join(',')}}`;
}

function hash(data) {
  return createHash('sha256').update(stableStringify(data)).digest('hex').slice(0, 16);
}

export class AnalysisCache {
  constructor(freecadRoot) {
    this.cacheDir = join(freecadRoot, '.cache');
  }

  async _ensureDir() {
    await mkdir(this.cacheDir, { recursive: true });
  }

  getCacheKey(stage, config, options = {}) {
    const extractor = STAGE_FIELDS[stage];
    if (!extractor) return null;

    const merged = { ...config };
    if (options.process || options.material) {
      merged.manufacturing = { ...(merged.manufacturing || {}) };
      if (options.process) merged.manufacturing.process = options.process;
      if (options.material) merged.manufacturing.material = options.material;
    }
    if (options.process) merged.process = options.process;
    if (options.material) merged.material = options.material;
    if (options.batch) merged.batch_size = options.batch;
    if (options.dxfExport != null) merged.dxfExport = options.dxfExport;
    if (options.shopProfile) merged.shop_profile = options.shopProfile;
    if (options.dfm_score != null) merged.dfm_score = options.dfm_score;
    if (options.monteCarlo != null) merged.monteCarlo = options.monteCarlo;
    if (options.mcSamples != null) merged.mcSamples = options.mcSamples;

    return `${stage}-${hash(extractor(merged))}`;
  }

  async checkCache(key) {
    if (!key) return { hit: false };
    try {
      const raw = await readFile(join(this.cacheDir, `${key}.json`), 'utf8');
      return { hit: true, entry: JSON.parse(raw) };
    } catch {
      return { hit: false };
    }
  }

  async storeCache(key, result, stage) {
    if (!key) return;
    await this._ensureDir();
    await writeFile(join(this.cacheDir, `${key}.json`), JSON.stringify({ result, stage, timestamp: Date.now() }));
    this._evictIfNeeded().catch(() => {});
  }

  async getCacheStats() {
    try {
      await this._ensureDir();
      const files = await readdir(this.cacheDir);
      const jsonFiles = files.filter((file) => file.endsWith('.json'));
      let totalSizeBytes = 0;
      const byStage = {};

      for (const file of jsonFiles) {
        const fileStat = await stat(join(this.cacheDir, file)).catch(() => null);
        if (!fileStat) continue;
        totalSizeBytes += fileStat.size;
        const stage = file.split('-')[0];
        byStage[stage] = (byStage[stage] || 0) + 1;
      }

      return { entries: jsonFiles.length, totalSizeBytes, byStage };
    } catch {
      return { entries: 0, totalSizeBytes: 0, byStage: {} };
    }
  }

  async clearCache(stage) {
    try {
      await this._ensureDir();
      const files = await readdir(this.cacheDir);
      const jsonFiles = files.filter((file) => {
        if (!file.endsWith('.json')) return false;
        if (stage) return file.startsWith(`${stage}-`);
        return true;
      });

      let deleted = 0;
      for (const file of jsonFiles) {
        await unlink(join(this.cacheDir, file)).catch(() => {});
        deleted += 1;
      }
      return { deleted };
    } catch {
      return { deleted: 0 };
    }
  }

  async _evictIfNeeded() {
    const files = await readdir(this.cacheDir);
    const jsonFiles = files.filter((file) => file.endsWith('.json'));
    const entries = [];
    let totalSize = 0;

    for (const file of jsonFiles) {
      const path = join(this.cacheDir, file);
      const fileStat = await stat(path).catch(() => null);
      if (!fileStat) continue;
      totalSize += fileStat.size;
      entries.push({ path, size: fileStat.size, mtime: fileStat.mtimeMs });
    }

    if (totalSize <= MAX_CACHE_BYTES) return;
    entries.sort((a, b) => a.mtime - b.mtime);

    while (totalSize > MAX_CACHE_BYTES && entries.length > 0) {
      const oldest = entries.shift();
      await unlink(oldest.path).catch(() => {});
      totalSize -= oldest.size;
    }
  }
}
