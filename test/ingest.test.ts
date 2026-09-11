import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestAll } from "../src/ingest";
import { resetPathsState } from "../src/paths";
import { getUsageStats, resetDb } from "../src/usage";

let dir: string;
let claudeDir: string;
let cursorDir: string;

function claudeLine(skill: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-09-01T10:00:00.000Z",
    message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
  });
}

function cursorReadLine(path: string): string {
  return JSON.stringify({
    role: "assistant",
    message: { content: [{ type: "tool_use", name: "ReadFile", input: { path } }] },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skiller-ingest-"));
  claudeDir = join(dir, "claude");
  cursorDir = join(dir, "cursor");
  mkdirSync(join(claudeDir, "proj"), { recursive: true });
  mkdirSync(join(cursorDir, "proj", "agent-transcripts", "sess-1"), { recursive: true });
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

describe("ingestAll", () => {
  const opts = { knownSkills: ["hono"] };

  test("registra skills invocados en transcripts de Claude Code", () => {
    writeFileSync(join(claudeDir, "proj", "abc.jsonl"), claudeLine("hono") + "\n");
    const result = ingestAll({ claudeDir, cursorDir, ...opts });
    expect(result.added).toBe(1);
    expect(result.byHarness["claude-code"]).toBe(1);
    const stats = getUsageStats();
    expect(stats[0]!.skillName).toBe("hono");
    expect(stats[0]!.harnesses).toEqual(["claude-code"]);
    expect(stats[0]!.firstUsed).toBe("2026-09-01T10:00:00.000Z");
  });

  test("registra lecturas de SKILL.md en transcripts de Cursor", () => {
    writeFileSync(
      join(cursorDir, "proj", "agent-transcripts", "sess-1", "sess-1.jsonl"),
      cursorReadLine("/Users/x/.cursor/skills/hono/SKILL.md") + "\n",
    );
    const result = ingestAll({ claudeDir, cursorDir, ...opts });
    expect(result.added).toBe(1);
    expect(result.byHarness["cursor"]).toBe(1);
  });

  test("ignora paths que no son skills instalados", () => {
    writeFileSync(
      join(cursorDir, "proj", "agent-transcripts", "sess-1", "sess-1.jsonl"),
      cursorReadLine("/Users/x/repo/packages/skills/src/index.ts") + "\n" +
        cursorReadLine("/Users/x/.claude/skills/_shared/common.md") + "\n",
    );
    writeFileSync(join(claudeDir, "proj", "abc.jsonl"), claudeLine("no-existe") + "\n");
    const result = ingestAll({ claudeDir, cursorDir, ...opts });
    expect(result.added).toBe(0);
  });

  test("no duplica sesiones ya registradas", () => {
    writeFileSync(join(claudeDir, "proj", "abc.jsonl"), claudeLine("hono") + "\n");
    const first = ingestAll({ claudeDir, cursorDir, ...opts });
    const second = ingestAll({ claudeDir, cursorDir, ...opts });
    expect(first.added).toBe(1);
    expect(second.added).toBe(0);
    expect(getUsageStats()[0]!.totalSessions).toBe(1);
  });

  test("agrupa múltiples usos del mismo skill en una sesión", () => {
    writeFileSync(
      join(claudeDir, "proj", "abc.jsonl"),
      claudeLine("hono") + "\n" + claudeLine("hono") + "\n",
    );
    ingestAll({ claudeDir, cursorDir, ...opts });
    expect(getUsageStats()[0]!.totalSessions).toBe(1);
  });
});
