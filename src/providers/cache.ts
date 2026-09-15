import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { ensureSkillerHome, providerCachePath, providersCacheDir } from "../paths";

interface CacheFile<T> {
  updatedAt: number;
  data: T;
}

export { providerCachePath } from "../paths";

export function readCache<T>(providerId: string): T | null {
  ensureSkillerHome();
  try {
    const raw = readFileSync(providerCachePath(providerId), "utf8");
    const parsed = JSON.parse(raw) as CacheFile<T>;
    if (parsed && typeof parsed === "object" && "data" in parsed) return parsed.data;
  } catch {}
  return null;
}

export function writeCache<T>(providerId: string, data: T): void {
  ensureSkillerHome();
  try {
    const path = providerCachePath(providerId);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify({ updatedAt: Date.now(), data } satisfies CacheFile<T>));
    renameSync(tmp, path);
  } catch {}
}

export function cacheFresh(providerId: string, ttlMs: number): boolean {
  ensureSkillerHome();
  const path = providerCachePath(providerId);
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheFile<unknown>;
    return Date.now() - parsed.updatedAt < ttlMs;
  } catch {}
  return false;
}

export function clearProviderCaches(): number {
  ensureSkillerHome();
  const dir = providersCacheDir();
  let removed = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".json")) {
        rmSync(join(dir, f));
        removed++;
      }
    }
  } catch {}
  return removed;
}

export function providerCacheInfo(): Array<{ id: string; updatedAt: number; entries: number }> {
  ensureSkillerHome();
  const dir = providersCacheDir();
  const out: Array<{ id: string; updatedAt: number; entries: number }> = [];
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(dir, f), "utf8")) as CacheFile<unknown>;
        const data = parsed.data;
        const entries = Array.isArray(data)
          ? data.length
          : typeof data === "object" && data !== null
            ? Object.keys(data).length
            : 0;
        out.push({ id: f.replace(/\.json$/, ""), updatedAt: parsed.updatedAt, entries });
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
