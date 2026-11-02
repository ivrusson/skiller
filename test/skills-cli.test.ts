import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentDisplayToSlug,
  computeRepairGaps,
  fetchSkillsListGlobal,
  indexByName,
  parseSkillsListJson,
  universeAgents,
} from "../src/skills-cli";
import { resetPathsState } from "../src/paths";

const FIXTURE = `[
  {
    "name": "demo",
    "path": "/Users/me/.agents/skills/demo",
    "scope": "global",
    "agents": ["Cursor", "Codex"],
    "source": "acme/skills",
    "sourceUrl": "https://github.com/acme/skills.git",
    "sourceType": "github"
  },
  {
    "name": "other",
    "path": "/Users/me/.agents/skills/other",
    "scope": "global",
    "agents": ["Cursor", "Codex", "Claude Code"],
    "source": "acme/other",
    "sourceType": "github"
  },
  {
    "name": "local-only",
    "path": "/Users/me/.agents/skills/local-only",
    "scope": "global",
    "agents": ["Cursor"],
    "source": "/Users/me/.agents/skills/local-only",
    "sourceType": "local"
  }
]`;

describe("agentDisplayToSlug", () => {
  test("mapea display names conocidos", () => {
    expect(agentDisplayToSlug("Claude Code")).toBe("claude-code");
    expect(agentDisplayToSlug("Cursor")).toBe("cursor");
    expect(agentDisplayToSlug("OpenCode")).toBe("opencode");
  });

  test("slugify fallback", () => {
    expect(agentDisplayToSlug("Some New Agent")).toBe("some-new-agent");
  });
});

describe("parseSkillsListJson", () => {
  test("parsea array y tolera prefijo npm notice", () => {
    const entries = parseSkillsListJson(`npm notice blah\n${FIXTURE}\n`);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.name).toBe("demo");
    expect(entries[0]!.agents).toEqual(["Cursor", "Codex"]);
  });
});

describe("computeRepairGaps", () => {
  test("detecta agentes faltantes vs universo", () => {
    const entries = parseSkillsListJson(FIXTURE);
    const gaps = computeRepairGaps(entries);
    const demo = gaps.find((g) => g.name === "demo");
    expect(demo).toBeTruthy();
    expect(demo!.missingDisplay).toContain("Claude Code");
    expect(demo!.missingSlugs).toContain("claude-code");
    expect(demo!.source).toBe("acme/skills");
    expect(gaps.find((g) => g.name === "local-only")).toBeUndefined();
    expect(gaps.find((g) => g.name === "other")).toBeUndefined();
  });

  test("filtra por nombre", () => {
    const entries = parseSkillsListJson(FIXTURE);
    const gaps = computeRepairGaps(entries, { names: ["demo"] });
    expect(gaps).toHaveLength(1);
  });
});

describe("universeAgents / indexByName", () => {
  test("universo ordenado", () => {
    const entries = parseSkillsListJson(FIXTURE);
    expect(universeAgents(entries)).toEqual(["Claude Code", "Codex", "Cursor"]);
  });

  test("indexByName", () => {
    const map = indexByName(parseSkillsListJson(FIXTURE));
    expect(map.get("demo")?.source).toBe("acme/skills");
  });
});

describe("fetchSkillsListGlobal", () => {
  const prevHome = process.env.SKILLER_HOME;
  let tmp: string;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.SKILLER_HOME;
    else process.env.SKILLER_HOME = prevHome;
    resetPathsState();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test("cachea y reutiliza sin re-spawn", async () => {
    tmp = mkdtempSync(join(tmpdir(), "skiller-skills-cli-"));
    process.env.SKILLER_HOME = tmp;
    resetPathsState();

    let calls = 0;
    const spawn = async () => {
      calls++;
      return { exit: 0, stdout: FIXTURE, stderr: "" };
    };

    const first = await fetchSkillsListGlobal({ spawn, ttlMs: 60_000 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.entries).toHaveLength(3);
    expect(calls).toBe(1);

    const second = await fetchSkillsListGlobal({ spawn, ttlMs: 60_000 });
    expect(second.ok).toBe(true);
    expect(calls).toBe(1);

    const refreshed = await fetchSkillsListGlobal({ spawn, refresh: true, ttlMs: 60_000 });
    expect(refreshed.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
