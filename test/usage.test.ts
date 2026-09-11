import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logUsage, logUsageOnce, getUsageStats, getSkillUsage, getHarnessSummary, getUnusedSkills, purgeUsage, resetDb, usageDbPath } from "../src/usage";
import { resetPathsState } from "../src/paths";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skiller-usage-"));
  process.env.SKILLER_HOME = dir;
  resetPathsState();
  resetDb();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SKILLER_HOME;
  resetPathsState();
  resetDb();
});

describe("logUsage", () => {
  test("registra un evento", () => {
    logUsage("hono", "claude", "s1");
    const stats = getUsageStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.skillName).toBe("hono");
    expect(stats[0]!.totalSessions).toBe(1);
  });

  test("cuenta múltiples sesiones", () => {
    logUsage("hono", "claude", "s1");
    logUsage("hono", "claude", "s2");
    logUsage("hono", "codex", "s3");
    const stats = getUsageStats();
    expect(stats[0]!.totalSessions).toBe(3);
    expect(stats[0]!.uniqueSessions).toBe(3);
    expect(stats[0]!.harnesses.sort()).toEqual(["claude", "codex"]);
  });

  test("separa skills diferentes", () => {
    logUsage("hono", "claude", "s1");
    logUsage("dokploy", "codex", "s2");
    const stats = getUsageStats();
    expect(stats).toHaveLength(2);
  });
});

describe("getSkillUsage", () => {
  test("devuelve null si no hay uso", () => {
    expect(getSkillUsage("inexistente")).toBeNull();
  });

  test("devuelve stats del skill", () => {
    logUsage("hono", "claude", "s1");
    const stats = getSkillUsage("hono");
    expect(stats).not.toBeNull();
    expect(stats!.totalSessions).toBe(1);
  });

  test("es insensible a mayúsculas", () => {
    logUsage("hono", "claude", "s1");
    const stats = getSkillUsage("HONO");
    expect(stats).not.toBeNull();
  });
});

describe("getHarnessSummary", () => {
  test("vacío sin datos", () => {
    expect(getHarnessSummary()).toEqual([]);
  });

  test("resume por harness", () => {
    logUsage("hono", "claude", "s1");
    logUsage("dokploy", "claude", "s2");
    logUsage("hono", "codex", "s3");
    const summary = getHarnessSummary();
    expect(summary).toHaveLength(2);
    const claude = summary.find((s) => s.harness === "claude");
    const codex = summary.find((s) => s.harness === "codex");
    expect(claude?.totalSessions).toBe(2);
    expect(claude?.uniqueSkills).toBe(2);
    expect(codex?.totalSessions).toBe(1);
    expect(codex?.uniqueSkills).toBe(1);
  });
});

describe("getUnusedSkills", () => {
  test("sin datos retorna vacío", () => {
    expect(getUnusedSkills(30)).toEqual([]);
  });

  test("detecta skills no usados en N días", () => {
    logUsageOnce("hono", "claude", "s1", Date.now() - 1000);
    const candidates = getUnusedSkills(0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.skillName).toBe("hono");
  });

  test("no incluye skills usados recientemente", () => {
    logUsage("hono", "claude", "s1");
    const candidates = getUnusedSkills(999999);
    expect(candidates).toHaveLength(0);
  });
});

describe("purgeUsage", () => {
  test("no borra registros recientes", () => {
    logUsage("hono", "claude", "s1");
    const removed = purgeUsage(1);
    expect(removed).toBe(0);
  });

  test("borra registros antiguos", () => {
    logUsage("hono", "claude", "s1");
    const dbPath = usageDbPath();
    const db = new Database(dbPath);
    db.run("UPDATE usage_events SET timestamp = timestamp - 400 * 24 * 60 * 60 * 1000");
    const removed = purgeUsage(365);
    expect(removed).toBe(1);
    expect(getUsageStats()).toHaveLength(0);
  });
});

describe("usageDbPath", () => {
  test("respeta SKILLER_HOME", () => {
    const path = usageDbPath();
    expect(path).toContain(dir);
    expect(path.endsWith("usage.db")).toBe(true);
  });
});
