import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Skiller data root — portable across macOS / Linux / Windows.
 *
 * Override with SKILLER_HOME (used in tests). Default: {homedir}/.skiller
 *
 * Layout:
 *   ~/.skiller/
 *     tags.json
 *     usage.db
 *     cache/
 *       registry.json
 *       providers/<id>.json
 */
export function skillerHome(): string {
  const override = process.env.SKILLER_HOME?.trim();
  if (override) return override;
  return join(homedir(), ".skiller");
}

export function tagsPath(): string {
  return join(skillerHome(), "tags.json");
}

export function usageDbPath(): string {
  return join(skillerHome(), "usage.db");
}

export function cacheDir(): string {
  return join(skillerHome(), "cache");
}

export function registryCachePath(): string {
  return join(cacheDir(), "registry.json");
}

export function providersCacheDir(): string {
  return join(cacheDir(), "providers");
}

export function providerCachePath(providerId: string): string {
  return join(providersCacheDir(), providerId + ".json");
}

function legacyConfigDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "skiller");
}

function legacyCacheDir(): string {
  // Historical bug in usage.ts used join(XDG_CACHE_HOME || homedir(), ".cache", "skiller")
  // when XDG unset → ~/.cache/skiller; when set → $XDG/.cache/skiller. Prefer the correct one.
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, "skiller");
  return join(homedir(), ".cache", "skiller");
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function migrateFile(dest: string, sources: string[]): void {
  if (existsSync(dest)) return;
  for (const src of sources) {
    if (!existsSync(src) || !statSync(src).isFile()) continue;
    try {
      ensureParent(dest);
      try {
        renameSync(src, dest);
      } catch {
        copyFileSync(src, dest);
      }
      return;
    } catch {}
  }
}

function migrateDir(dest: string, sources: string[]): void {
  if (existsSync(dest)) {
    try {
      if (readdirSync(dest).length > 0) return;
    } catch {
      return;
    }
  }
  for (const src of sources) {
    if (!existsSync(src) || !statSync(src).isDirectory()) continue;
    try {
      mkdirSync(dest, { recursive: true });
      for (const f of readdirSync(src)) {
        const from = join(src, f);
        const to = join(dest, f);
        if (existsSync(to)) continue;
        try {
          renameSync(from, to);
        } catch {
          copyFileSync(from, to);
        }
      }
      try {
        rmSync(src, { recursive: true, force: true });
      } catch {}
      return;
    } catch {}
  }
}

/** Move data from legacy XDG paths into ~/.skiller (idempotent). */
export function migrateLegacyData(): void {
  const legacyCache = legacyCacheDir();
  const legacyConfig = legacyConfigDir();
  const buggyUsage = join(homedir(), ".cache", "skiller", "usage.db");

  migrateFile(tagsPath(), [join(legacyConfig, "tags.json")]);
  migrateFile(usageDbPath(), [join(legacyCache, "usage.db"), buggyUsage]);
  migrateFile(registryCachePath(), [join(legacyCache, "registry.json")]);
  migrateDir(providersCacheDir(), [join(legacyCache, "providers")]);
}

let migrated = false;

/** Ensure home exists and legacy data has been pulled in once per process. */
export function ensureSkillerHome(): string {
  const home = skillerHome();
  mkdirSync(home, { recursive: true });
  if (!migrated) {
    migrated = true;
    if (!process.env.SKILLER_HOME) migrateLegacyData();
  }
  return home;
}

/** Test helper — allow re-running migration after env changes. */
export function resetPathsState(): void {
  migrated = false;
}
