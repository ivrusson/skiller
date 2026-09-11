import { describe, expect, test } from "bun:test";
import {
  buildRelations,
  groupUsageByRelation,
  normalizeRepo,
  ownerOf,
} from "../src/relations";
import { ingestAll } from "../src/ingest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetPathsState } from "../src/paths";
import { getUsageStats, resetDb } from "../src/usage";

describe("normalizeRepo / ownerOf", () => {
  test("normaliza owner/repo y sufijos de marketplace", () => {
    expect(normalizeRepo("Vercel-Labs/Agent-Skills")).toBe("vercel-labs/agent-skills");
    expect(normalizeRepo("acme/foo (/skills/bar)")).toBe("acme/foo");
    expect(normalizeRepo("not-a-repo")).toBeNull();
    expect(ownerOf("vercel-labs/agent-skills")).toBe("vercel-labs");
  });
});

describe("buildRelations", () => {
  test("agrupa siblings del mismo repo y sameOwner", () => {
    const rel = buildRelations([
      { name: "hono", source: "vercel-labs/agent-skills" },
      { name: "react-best-practices", source: "vercel-labs/agent-skills" },
      { name: "other", source: "vercel-labs/other-repo" },
      { name: "orphan", source: null },
    ]);
    expect(rel.get("hono")!.siblings).toEqual(["react-best-practices"]);
    expect(rel.get("hono")!.sameOwner.sort()).toEqual(["other", "react-best-practices"]);
    expect(rel.get("orphan")!.repo).toBeNull();
    expect(rel.get("orphan")!.siblings).toEqual([]);
  });
});

describe("groupUsageByRelation", () => {
  test("agrega sesiones por repo e incluye unused", () => {
    const relations = buildRelations([
      { name: "hono", source: "acme/pack" },
      { name: "kit", source: "acme/pack" },
      { name: "solo", source: "acme/solo" },
    ]);
    const groups = groupUsageByRelation(
      [
        { skillName: "hono", totalSessions: 3, uniqueSessions: 2, lastUsed: "2026-09-01T00:00:00.000Z" },
        { skillName: "solo", totalSessions: 1, uniqueSessions: 1, lastUsed: "2026-08-01T00:00:00.000Z" },
      ],
      relations,
      "repo",
      ["hono", "kit", "solo"],
    );
    expect(groups[0]!.key).toBe("acme/pack");
    expect(groups[0]!.totalSessions).toBe(3);
    expect(groups[0]!.unused).toEqual(["kit"]);
    expect(groups.map((g) => g.key)).toContain("acme/solo");
  });
});

describe("ingestAll relations", () => {
  test("reporta byRepo / byOwner y related siblings sin creditar siblings", () => {
    const dir = mkdtempSync(join(tmpdir(), "skiller-rel-"));
    const claudeDir = join(dir, "claude");
    const cursorDir = join(dir, "cursor");
    mkdirSync(join(claudeDir, "proj"), { recursive: true });
    mkdirSync(join(cursorDir, "proj", "agent-transcripts", "sess-1"), { recursive: true });
    process.env.SKILLER_HOME = dir;
    resetPathsState();
    resetDb();

    writeFileSync(
      join(claudeDir, "proj", "abc.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-09-01T10:00:00.000Z",
        message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "hono" } }] },
      }) + "\n",
    );

    const result = ingestAll({
      claudeDir,
      cursorDir,
      knownSkills: ["hono", "kit"],
      sources: {
        hono: "acme/pack",
        kit: "acme/pack",
      },
    });

    expect(result.added).toBe(1);
    expect(result.byRepo["acme/pack"]).toBe(1);
    expect(result.byOwner["acme"]).toBe(1);
    expect(result.related.hono!.siblings).toEqual(["kit"]);
    expect(getUsageStats().map((s) => s.skillName)).toEqual(["hono"]);

    rmSync(dir, { recursive: true, force: true });
    delete process.env.SKILLER_HOME;
    resetPathsState();
    resetDb();
  });
});
