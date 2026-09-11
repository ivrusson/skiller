import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureSkillerHome, registryCachePath } from "./paths";

export interface RegistryMatch {
  id: string;
  installs: number;
  source: string;
  url: string;
}

interface CacheFile {
  updatedAt: number;
  entries: Record<string, RegistryMatch | null>;
}

const TTL_MS = 24 * 60 * 60 * 1000;
const API = "https://skills.sh/api/search?q=";

function cachePath(): string {
  ensureSkillerHome();
  return registryCachePath();
}

function loadCache(): CacheFile {
  try {
    const raw = readFileSync(cachePath(), "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed && typeof parsed === "object" && parsed.entries) return parsed;
  } catch {}
  return { updatedAt: 0, entries: {} };
}

function saveCache(cache: CacheFile): void {
  try {
    const path = cachePath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, path);
  } catch {}
}

interface RawSkill {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

export function pickBest(results: RawSkill[], name: string): RegistryMatch | null {
  const lower = name.toLowerCase();
  const best =
    results.find((s) => s.skillId?.toLowerCase() === lower) ??
    results.find((s) => s.name?.toLowerCase() === lower);
  if (!best) return null;
  return {
    id: best.id,
    installs: best.installs ?? 0,
    source: best.source,
    url: `https://www.skills.sh/${best.id}`,
  };
}

async function fetchMatch(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<RegistryMatch | null | undefined> {
  try {
    const res = await fetcher(`${API}${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return undefined; // HTTP error (rate limit, outage) — keep previous cache
    const json = (await res.json()) as { skills?: RawSkill[] };
    return pickBest(json.skills ?? [], name); // null (no match) is safe to cache
  } catch {
    return undefined; // network error — keep previous cache
  }
}

async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function enrich(
  names: string[],
  opts: { refresh?: boolean; fetch?: typeof fetch } = {},
): Promise<Record<string, RegistryMatch | null>> {
  const unique = [...new Set(names)];
  const cache = loadCache();
  const fresh = Date.now() - cache.updatedAt < TTL_MS;
  const missing = unique.filter((n) => opts.refresh || !fresh || !(n in cache.entries));
  const fetcher = opts.fetch ?? fetch;
  // Full refresh hits skills.sh hard — keep concurrency low to reduce 429s.
  const concurrency = opts.refresh ? 2 : 5;

  if (missing.length) {
    let done = 0;
    let wrote = 0;
    await runPool(missing, concurrency, async (name) => {
      const match = await fetchMatch(name, fetcher);
      // Only persist successful responses. Failed fetches must not wipe prior entries
      // (that made trust badges fall back to "?" after Refresh).
      if (match !== undefined) {
        cache.entries[name] = match;
        wrote++;
      }
      done++;
      if (process.env.SKILLER_VERBOSE) {
        console.error(`[registry] ${done}/${missing.length} ${name}${match === undefined ? " (kept cache)" : ""}`);
      }
    });
    if (wrote > 0) {
      cache.updatedAt = Date.now();
      saveCache(cache);
    }
  }

  const out: Record<string, RegistryMatch | null> = {};
  for (const n of unique) out[n] = cache.entries[n] ?? null;
  return out;
}

export function cacheInfo(): { path: string; exists: boolean; updatedAt: number; entries: number } {
  const path = cachePath();
  if (!existsSync(path)) return { path, exists: false, updatedAt: 0, entries: 0 };
  const c = loadCache();
  return { path, exists: true, updatedAt: c.updatedAt, entries: Object.keys(c.entries).length };
}

/** Read cached registry sources without network (for relation grouping). */
export function cachedSources(names?: string[]): Record<string, string | null> {
  const cache = loadCache();
  const out: Record<string, string | null> = {};
  const keys = names ?? Object.keys(cache.entries);
  for (const n of keys) {
    const match = cache.entries[n];
    out[n] = match?.source ?? match?.id ?? null;
  }
  return out;
}
