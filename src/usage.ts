import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { ensureSkillerHome, usageDbPath as pathsUsageDbPath } from "./paths";

export interface UsageEvent {
  id: number;
  skillName: string;
  harness: string;
  sessionId: string;
  timestamp: number;
}

export interface SkillStats {
  skillName: string;
  totalSessions: number;
  uniqueSessions: number;
  harnesses: string[];
  lastUsed: string | null;
  firstUsed: string | null;
}

export interface HarnessStats {
  harness: string;
  totalSessions: number;
  uniqueSkills: number;
}

export interface CandidateForRemoval {
  skillName: string;
  totalSessions: number;
  lastUsed: string | null;
  daysSinceLastUse: number | null;
}

function dbPath(): string {
  ensureSkillerHome();
  return pathsUsageDbPath();
}

let dbInstance: ReturnType<typeof openDb> | null = null;

function openDb() {
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL,
      harness TEXT NOT NULL,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_skill_name ON usage_events(skill_name)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_harness ON usage_events(harness)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_timestamp ON usage_events(timestamp)`);
  return db;
}

function db(): ReturnType<typeof openDb> {
  if (!dbInstance) dbInstance = openDb();
  return dbInstance;
}

export function logUsage(skillName: string, harness: string, sessionId: string): void {
  const database = db();
  database.run(
    "INSERT INTO usage_events (skill_name, harness, session_id, timestamp) VALUES (?, ?, ?, ?)",
    [skillName, harness, sessionId, Date.now()],
  );
}

export function logUsageOnce(
  skillName: string,
  harness: string,
  sessionId: string,
  timestamp?: number,
): boolean {
  const database = db();
  const existing = database
    .prepare("SELECT 1 FROM usage_events WHERE skill_name = ? AND harness = ? AND session_id = ?")
    .get(skillName, harness, sessionId);
  if (existing) return false;
  database.run(
    "INSERT INTO usage_events (skill_name, harness, session_id, timestamp) VALUES (?, ?, ?, ?)",
    [skillName, harness, sessionId, timestamp ?? Date.now()],
  );
  return true;
}

export function getUsageStats(): SkillStats[] {
  const database = db();
  const stmt = database.prepare(`
    SELECT
      skill_name,
      COUNT(*) as total,
      COUNT(DISTINCT session_id) as unique_count,
      GROUP_CONCAT(DISTINCT harness) as harnesses,
      MAX(timestamp) as last,
      MIN(timestamp) as first
    FROM usage_events
    GROUP BY skill_name
    ORDER BY total DESC
  `);
  const rows = Array.from(
    stmt.all() as {
      skill_name: string;
      total: number;
      unique_count: number;
      harnesses: string;
      last: number | null;
      first: number | null;
    }[],
  );

  return rows.map((r) => ({
    skillName: r.skill_name,
    totalSessions: r.total,
    uniqueSessions: r.unique_count,
    harnesses: r.harnesses.split(","),
    lastUsed: r.last ? new Date(r.last).toISOString() : null,
    firstUsed: r.first ? new Date(r.first).toISOString() : null,
  }));
}

export function getSkillUsage(skillName: string): SkillStats | null {
  const stats = getUsageStats();
  return stats.find((s) => s.skillName.toLowerCase() === skillName.toLowerCase()) ?? null;
}

export function getHarnessSummary(): HarnessStats[] {
  const database = db();
  const stmt = database.prepare(`
    SELECT
      harness,
      COUNT(*) as total,
      COUNT(DISTINCT skill_name) as unique_skills
    FROM usage_events
    GROUP BY harness
    ORDER BY total DESC
  `);
  const rows = Array.from(
    stmt.all() as { harness: string; total: number; unique_skills: number }[],
  );

  return rows.map((r) => ({
    harness: r.harness,
    totalSessions: r.total,
    uniqueSkills: r.unique_skills,
  }));
}

export function getUnusedSkills(daysThreshold = 90): CandidateForRemoval[] {
  const database = db();
  const threshold = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
  const stmt = database.prepare(`
    SELECT
      skill_name,
      COUNT(*) as total,
      MAX(timestamp) as last
     FROM usage_events
     GROUP BY skill_name
     HAVING last < ?
     ORDER BY last ASC
  `);
  const rows = Array.from(
    stmt.all(threshold as any) as { skill_name: string; total: number; last: number | null }[],
  );

  return rows.map((r) => ({
    skillName: r.skill_name,
    totalSessions: r.total,
    lastUsed: r.last ? new Date(r.last).toISOString() : null,
    daysSinceLastUse: r.last ? Math.floor((Date.now() - r.last) / (24 * 60 * 60 * 1000)) : null,
  }));
}

export function purgeUsage(daysThreshold = 365): number {
  const database = db();
  const threshold = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
  const stmt = database.prepare("DELETE FROM usage_events WHERE timestamp < ?");
  const result = stmt.run(threshold as [number][0]);
  return result.changes;
}

export function usageDbPath(): string {
  return dbPath();
}

export function resetDb(): void {
  dbInstance = null;
}
