import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrich, pickBest } from "../src/registry";
import { resetPathsState } from "../src/paths";

describe("pickBest", () => {
  const results = [
    {
      id: "alice/misc/retro-copy",
      skillId: "retro-copy",
      name: "retro",
      installs: 5,
      source: "alice/misc",
    },
    {
      id: "yusukebe/hono-skill/hono",
      skillId: "hono",
      name: "hono",
      installs: 12732,
      source: "yusukebe/hono-skill",
    },
    {
      id: "bob/something/hono-api",
      skillId: "hono-api",
      name: "hono-api",
      installs: 99,
      source: "bob/something",
    },
  ];

  test("coincidencia exacta por skillId", () => {
    const best = pickBest(results, "hono");
    expect(best?.id).toBe("yusukebe/hono-skill/hono");
    expect(best?.installs).toBe(12732);
    expect(best?.url).toBe("https://www.skills.sh/yusukebe/hono-skill/hono");
  });

  test("no acepta coincidencias fuzzy (evita datos engañosos)", () => {
    expect(pickBest(results, "teach")).toBeNull();
    expect(pickBest(results, "hono-api-scaffolder")).toBeNull();
  });

  test("sí acepta coincidencia por name aunque el skillId difiera", () => {
    const best = pickBest(results, "retro");
    expect(best?.id).toBe("alice/misc/retro-copy");
  });

  test("lista vacía devuelve null", () => {
    expect(pickBest([], "hono")).toBeNull();
  });

  test("es insensible a mayúsculas", () => {
    const best = pickBest(results, "HONO");
    expect(best?.id).toBe("yusukebe/hono-skill/hono");
  });
});

describe("enrich refresh preserves cache on fetch failure", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skiller-reg-"));
    process.env.SKILLER_HOME = dir;
    resetPathsState();
    mkdirSync(join(dir, "cache"), { recursive: true });
    writeFileSync(
      join(dir, "cache", "registry.json"),
      JSON.stringify({
        updatedAt: Date.now() - 60_000,
        entries: {
          hono: {
            id: "yusukebe/hono-skill/hono",
            installs: 12732,
            source: "yusukebe/hono-skill",
            url: "https://www.skills.sh/yusukebe/hono-skill/hono",
          },
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.SKILLER_HOME;
    resetPathsState();
  });

  test("HTTP error en refresh no borra la entrada previa", async () => {
    const out = await enrich(["hono"], {
      refresh: true,
      fetch: (async () => new Response("nope", { status: 429 })) as typeof fetch,
    });
    expect(out.hono?.installs).toBe(12732);
    expect(out.hono?.source).toBe("yusukebe/hono-skill");
  });

  test("respuesta ok actualiza la entrada", async () => {
    const out = await enrich(["hono"], {
      refresh: true,
      fetch: (async () =>
        Response.json({
          skills: [
            {
              id: "yusukebe/hono-skill/hono",
              skillId: "hono",
              name: "hono",
              installs: 99,
              source: "yusukebe/hono-skill",
            },
          ],
        })) as typeof fetch,
    });
    expect(out.hono?.installs).toBe(99);
  });
});
