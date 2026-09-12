import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { marketplacesProvider } from "../src/providers/marketplaces";
import { skillsShProvider } from "../src/providers/skills-sh";
import { explore, type RemoteSkill } from "../src/providers";
import { resetPathsState } from "../src/paths";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skiller-providers-"));
  process.env.SKILLER_HOME = dir;
  resetPathsState();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SKILLER_HOME;
  resetPathsState();
});

function jsonResponse(data: unknown, ok = true): Response {
  return new Response(JSON.stringify(data), { status: ok ? 200 : 500 });
}

function fetcherByUrl(map: Record<string, unknown>): (url: string) => Promise<Response> {
  return async (url: string) => {
    const hit = map[url];
    if (hit === undefined) return jsonResponse({}, false);
    return jsonResponse(hit);
  };
}

describe("skillsShProvider", () => {
  const api = (q: string) => `https://skills.sh/api/search?q=${encodeURIComponent(q)}`;

  test("mapea resultados crudos a RemoteSkill", async () => {
    const f = fetcherByUrl({
      [api("hono")]: {
        skills: [{ id: "vercel/hono", skillId: "hono", name: "hono", installs: 1200, source: "vercel/hono" }],
      },
    });
    const results = await skillsShProvider.search("hono", f);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "hono",
      provider: "skills.sh",
      repo: "vercel/hono",
      installs: 1200,
      url: "https://www.skills.sh/vercel/hono",
    });
  });

  test("usa la caché en la segunda búsqueda del mismo término", async () => {
    const f = fetcherByUrl({ [api("react")]: { skills: [{ id: "o/r", skillId: "react", name: "react", installs: 5, source: "o/r" }] } });
    await skillsShProvider.search("react", f);
    const results = await skillsShProvider.search("react", async () => jsonResponse({}, false));
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("react");
  });
});

describe("marketplacesProvider", () => {
  const raw = (repo: string) => `https://raw.githubusercontent.com/${repo}/HEAD/.claude-plugin/marketplace.json`;

  test("parsea plugins de un marketplace.json", async () => {
    const f = fetcherByUrl({
      [raw("anthropics/claude-plugins-official")]: {
        name: "official",
        plugins: [
          { name: "plugin-a", description: "Does A", keywords: ["testing", "ci"], source: "./plugins/a" },
          { name: "plugin-b", description: "Does B", source: { source: "github", repo: "someone/b" } },
        ],
      },
      [raw("alirezarezvani/claude-skills")]: {},
      [raw("addyosmani/agent-skills")]: {},
    });
    const results = await marketplacesProvider.search("plugin-a", f);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "plugin-a",
      repo: "anthropics/claude-plugins-official (/plugins/a)",
      tags: ["testing", "ci"],
    });
    const all = await marketplacesProvider.search("", f);
    expect(all.length).toBe(2);
  });
});

describe("explore", () => {
  test("deduplica por repo y marca instalados", async () => {
    const f = async (url: string): Promise<Response> => {
      if (url.startsWith("https://skills.sh/")) {
        return jsonResponse({ skills: [{ id: "o/hono", skillId: "hono", name: "hono", installs: 10, source: "o/hono" }] });
      }
      return jsonResponse({
        name: "m",
        plugins: [{ name: "hono", description: "same repo", source: { source: "github", repo: "o/hono" } }],
      });
    };
    const { providers } = await import("../src/providers");
    const clawIdx = providers.findIndex((p) => p.id === "clawhub");
    const [claw] = providers.splice(clawIdx, 1); // keep the test offline & deterministic
    const original = globalThis.fetch;
    globalThis.fetch = f as typeof fetch;
    try {
      const results = await explore("hono", { installedNames: ["HONO"] });
      expect(results).toHaveLength(1);
      expect(results[0]!.installed).toBe(true);
      expect(results[0]!.provider).toContain("skills.sh");
      expect(results[0]!.provider).toContain("marketplace");
    } finally {
      globalThis.fetch = original;
      providers.push(claw!);
    }
  });

  test("ordena por installs desc", async () => {
    const { providers } = await import("../src/providers");
    const originals = providers.map((p) => [p, p.search] as const);
    for (const p of providers) {
      if (p.id === "skills-sh") {
        p.search = (async () => [
          { name: "a", description: "", url: "", provider: "skills.sh", installs: 5 },
          { name: "b", description: "", url: "", provider: "skills.sh", installs: 50 },
        ]) as typeof p.search;
      } else {
        p.search = (async () => []) as typeof p.search;
      }
    }
    try {
      const out = await explore("a");
      expect(out[0]!.name).toBe("b");
    } finally {
      for (const [p, orig] of originals) p.search = orig;
    }
  });
});

describe("installFromRepo validation", () => {
  test("acepta owner/repo y recheta entradas inválidas", async () => {
    const { isInstallableRepo } = await import("../src/install");
    expect(isInstallableRepo("vercel/hono")).toBe(true);
    expect(isInstallableRepo("o/r (/path)")).toBe(false);
    expect(isInstallableRepo("a b/c")).toBe(false);
    expect(isInstallableRepo("-bad/repo")).toBe(false);
    expect(isInstallableRepo("")).toBe(false);
    expect(isInstallableRepo(undefined)).toBe(false);
  });
});

describe("skillsMpProvider", () => {
  test("sincroniza catálogo paginado y filtra por término", async () => {
    const { skillsMpProvider } = await import("../src/providers/skillsmp");
    const pages: Record<string, unknown> = {
      "https://skillsmp.com/api/skills?page=1": {
        skills: [
          { name: "react-patterns", description: "React hooks guidance", githubUrl: "https://github.com/o/react-patterns", stars: 40 },
          { name: "vue-helper", description: "Vue stuff", githubUrl: "https://github.com/o/vue", stars: 3 },
        ],
        pagination: { page: 1, totalPages: 2 },
      },
      "https://skillsmp.com/api/skills?page=2": {
        skills: [{ name: "react-server", description: "SSR", route: { ownerSlug: "o", repoSlug: "react-server" }, stars: 7 }],
        pagination: { page: 2, totalPages: 2 },
      },
    };
    const f = async (url: string) => {
      const hit = pages[url];
      return hit === undefined ? jsonResponse({}, false) : jsonResponse(hit);
    };
    const all = await skillsMpProvider.search("react", f);
    expect(all).toHaveLength(2);
    expect(all[0]!.provider).toBe("skillsmp");
    expect(all[0]!.repo).toBe("o/react-patterns");
    expect(all[1]!.repo).toBe("o/react-server");
    expect(all[1]!.url).toBe("https://github.com/o/react-server");
  });
});

describe("awesomeProvider", () => {
  test("parsea tabla markdown (travisvn) y lista (hesreallyhim)", async () => {
    const { awesomeProvider } = await import("../src/providers/awesome");
    const table = "# list\n\n| **[ios-simulator-skill](https://github.com/conorluddy/ios-simulator-skill)** | Build iOS apps |\n| not-a-row |\n";
    const list = "## Skills\n\n- [Caveman](https://github.com/JuliusBrussee/caveman) by [Julius Brussee](https://github.com/x) - A plugin that conserves tokens\n<img src=\"badge\">\n- [NoDesc](https://github.com/a/b)\n";
    const f = async (url: string) => {
      if (url.includes("travisvn")) return new Response(table);
      if (url.includes("hesreallyhim")) return new Response(list);
      return jsonResponse({}, false);
    };
    const ios = await awesomeProvider.search("ios-simulator", f);
    expect(ios).toHaveLength(1);
    expect(ios[0]!).toMatchObject({ name: "ios-simulator-skill", repo: "conorluddy/ios-simulator-skill", description: "Build iOS apps" });
    const cave = await awesomeProvider.search("caveman", f);
    expect(cave[0]!.description).toContain("conserves tokens");
    const all = await awesomeProvider.search("", f);
    expect(all).toHaveLength(0); // término vacío no busca
  });
});

describe("clawhubProvider", () => {
  test("parsea slugs del output del CLI", async () => {
    const { parseClawhubOutput } = await import("../src/providers/clawhub");
    const out = [
      "@vercel/hono  Hono API framework skill",
      "someone/else | another skill",
      "no slug here",
      "@vercel/hono  duplicate",
    ].join("\n");
    const results = parseClawhubOutput(out);
    expect(results).toHaveLength(2);
    expect(results[0]!).toMatchObject({ name: "hono", repo: "vercel/hono", provider: "clawhub" });
    expect(results[0]!.description).toContain("Hono API");
  });
});

describe("explore dedup and ranking (F4)", () => {
  async function withMockedProviders(resultsByProvider: Record<string, RemoteSkill[]>, fn: () => Promise<void>) {
    const { providers } = await import("../src/providers");
    const originals = providers.map((p) => [p, p.search] as const);
    for (const p of providers) {
      const mocked = resultsByProvider[p.id] ?? [];
      p.search = (async () => mocked) as typeof p.search;
    }
    try {
      await fn();
    } finally {
      for (const [p, orig] of originals) p.search = orig;
    }
  }

  test("merge fuzzy: mismo nombre normalizado con repo basename distinto en owner", async () => {
    const { explore } = await import("../src/providers");
    await withMockedProviders({
      "skills-sh": [{ name: "code-review", description: "", url: "", provider: "skills.sh", repo: "acme/code-review", installs: 100 }],
      marketplace: [{ name: "claude-code-review", description: "", url: "", provider: "marketplace", repo: "other/code-review" }],
      skillsmp: [{ name: "telegram-bot", description: "", url: "", provider: "skillsmp", repo: "x/telegram-bot" }],
    }, async () => {
      const out = await explore("review");
      const names = out.map((o) => o.name);
      expect(names).toContain("code-review");
      expect(names).not.toContain("claude-code-review");
      const merged = out.find((o) => o.name === "code-review")!;
      expect(merged.provider).toContain("skills.sh");
      expect(merged.provider).toContain("marketplace");
      expect(merged.installs).toBe(100);
    });
  });

  test("no mergea si el basename del repo difiere", async () => {
    const { explore } = await import("../src/providers");
    await withMockedProviders({
      "skills-sh": [{ name: "hono", description: "", url: "", provider: "skills.sh", repo: "a/hono" }],
      skillsmp: [{ name: "hono", description: "", url: "", provider: "skillsmp", repo: "b/hono-api" }],
    }, async () => {
      const out = await explore("hono");
      expect(out).toHaveLength(2);
    });
  });

  test("ranking: installs dominan, stars desempatan con peso 1/50", async () => {
    const { explore } = await import("../src/providers");
    await withMockedProviders({
      "skills-sh": [
        { name: "low", description: "", url: "", provider: "skills.sh", installs: 100 },
        { name: "starred", description: "", url: "", provider: "skills.sh", installs: 100, stars: 1000 },
        { name: "top", description: "", url: "", provider: "skills.sh", installs: 500 },
      ],
    }, async () => {
      const out = await explore("x");
      expect(out.map((o) => o.name)).toEqual(["top", "starred", "low"]);
      expect(out[0]!.score).toBe(500);
      expect(out[1]!.score).toBe(120);
    });
  });
});

describe("provider cache refresh", () => {
  test("clearProviderCaches borra catálogos y providerCacheInfo los lista", async () => {
    const { writeCache, clearProviderCaches, providerCacheInfo } = await import("../src/providers/cache");
    writeCache("marketplace", [1, 2]);
    writeCache("awesome", [1]);
    let info = providerCacheInfo();
    expect(info).toHaveLength(2);
    expect(info.find((i) => i.id === "marketplace")!.entries).toBe(2);
    expect(clearProviderCaches()).toBe(2);
    info = providerCacheInfo();
    expect(info).toHaveLength(0);
  });
});

describe("assessTrust", () => {
  test("marca high para publisher conocido con muchos installs en skills.sh", async () => {
    const { assessTrust } = await import("../src/providers/trust");
    const t = assessTrust({
      provider: "skills.sh",
      repo: "anthropics/skills",
      installs: 12_000,
    });
    expect(t.level).toBe("high");
    expect(t.reasons.some((r) => r.includes("anthropics"))).toBe(true);
  });

  test("unknown sin señales", async () => {
    const { assessTrust } = await import("../src/providers/trust");
    const t = assessTrust({ provider: "clawhub" });
    expect(t.level).toBe("unknown");
  });

  test("explore adjunta trust a cada resultado", async () => {
    const { explore, providers } = await import("../src/providers");
    const originals = providers.map((p) => [p, p.search] as const);
    for (const p of providers) {
      p.search = (async () =>
        p.id === "skills-sh"
          ? [{ name: "hono", description: "x", url: "https://skills.sh/vercel/hono", provider: "skills.sh", repo: "vercel/hono", installs: 2000 }]
          : []) as typeof p.search;
    }
    try {
      const out = await explore("hono");
      expect(out[0]!.trust?.level).toBe("high");
    } finally {
      for (const [p, orig] of originals) p.search = orig;
    }
  });
});
