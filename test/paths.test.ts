import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  cacheDir,
  ensureSkillerHome,
  migrateLegacyData,
  providerCachePath,
  providersCacheDir,
  registryCachePath,
  resetPathsState,
  skillerHome,
  tagsPath,
  usageDbPath,
} from "../src/paths";

let dir: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.SKILLER_HOME;
  dir = mkdtempSync(join(tmpdir(), "skiller-paths-"));
  process.env.SKILLER_HOME = dir;
  resetPathsState();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevHome === undefined) delete process.env.SKILLER_HOME;
  else process.env.SKILLER_HOME = prevHome;
  resetPathsState();
});

describe("skillerHome", () => {
  test("usa SKILLER_HOME cuando está definido", () => {
    expect(skillerHome()).toBe(dir);
  });

  test("por defecto es {homedir}/.skiller", () => {
    delete process.env.SKILLER_HOME;
    expect(skillerHome()).toBe(join(homedir(), ".skiller"));
  });

  test("layout bajo el home", () => {
    expect(tagsPath()).toBe(join(dir, "tags.json"));
    expect(usageDbPath()).toBe(join(dir, "usage.db"));
    expect(registryCachePath()).toBe(join(dir, "cache", "registry.json"));
    expect(providerCachePath("skills-sh")).toBe(join(dir, "cache", "providers", "skills-sh.json"));
    expect(providersCacheDir()).toBe(join(dir, "cache", "providers"));
    expect(cacheDir()).toBe(join(dir, "cache"));
  });
});

describe("migrateLegacyData", () => {
  test("migra tags, registry, usage y providers desde rutas XDG", () => {
    const legacyRoot = mkdtempSync(join(tmpdir(), "skiller-legacy-"));
    const config = join(legacyRoot, "config");
    const cache = join(legacyRoot, "cache");
    const home = mkdtempSync(join(tmpdir(), "skiller-new-"));

    process.env.XDG_CONFIG_HOME = config;
    process.env.XDG_CACHE_HOME = cache;
    process.env.SKILLER_HOME = home;
    resetPathsState();

    mkdirSync(join(config, "skiller"), { recursive: true });
    mkdirSync(join(cache, "skiller", "providers"), { recursive: true });
    writeFileSync(join(config, "skiller", "tags.json"), JSON.stringify({ hono: ["x"] }));
    writeFileSync(
      join(cache, "skiller", "registry.json"),
      JSON.stringify({ updatedAt: 1, entries: {} }),
    );
    writeFileSync(join(cache, "skiller", "usage.db"), "sqlite");
    writeFileSync(
      join(cache, "skiller", "providers", "skills-sh.json"),
      JSON.stringify({ updatedAt: 1, data: [] }),
    );

    migrateLegacyData();

    expect(JSON.parse(readFileSync(join(home, "tags.json"), "utf8"))).toEqual({ hono: ["x"] });
    expect(existsSync(join(home, "cache", "registry.json"))).toBe(true);
    expect(existsSync(join(home, "usage.db"))).toBe(true);
    expect(existsSync(join(home, "cache", "providers", "skills-sh.json"))).toBe(true);

    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CACHE_HOME;
    rmSync(legacyRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
});

describe("ensureSkillerHome", () => {
  test("crea el directorio", () => {
    const home = ensureSkillerHome();
    expect(home).toBe(dir);
    expect(existsSync(dir)).toBe(true);
  });
});
