import { describe, expect, test } from "bun:test";
import {
  cleanRepo,
  isClawhubProvider,
  isInstallableRepo,
  installSkill,
  normalizeList,
  planInstall,
  planRepair,
  planUninstall,
  planUpdate,
  resolveProvider,
  uninstallSkill,
} from "../src/install";

describe("cleanRepo / isInstallableRepo", () => {
  test("acepta owner/repo", () => {
    expect(isInstallableRepo("vercel/hono")).toBe(true);
    expect(cleanRepo("vercel/hono")).toBe("vercel/hono");
  });

  test("limpia sufijos de marketplace", () => {
    expect(cleanRepo("acme/skills (/plugins/foo)")).toBe("acme/skills");
  });

  test("rechaza entradas inválidas", () => {
    expect(isInstallableRepo("-bad/repo")).toBe(false);
    expect(cleanRepo("not a repo")).toBe(null);
    expect(cleanRepo(undefined)).toBe(null);
  });
});

describe("normalizeList", () => {
  test("aplana CSV y deduplica", () => {
    expect(normalizeList(["claude-code", "cursor,opencode", "cursor"])).toEqual([
      "claude-code",
      "cursor",
      "opencode",
    ]);
  });
});

describe("resolveProvider", () => {
  test("explícito gana", () => {
    expect(resolveProvider("clawhub", "skills.sh")).toBe("clawhub");
    expect(resolveProvider("skills", "clawhub")).toBe("skills");
  });

  test("detecta clawhub en provider compuesto", () => {
    expect(isClawhubProvider("skills.sh + clawhub")).toBe(true);
    expect(resolveProvider(undefined, "skills.sh + clawhub")).toBe("clawhub");
    expect(resolveProvider(undefined, "skills.sh")).toBe("skills");
  });
});

describe("planInstall", () => {
  test("skills por defecto", () => {
    const p = planInstall({ repo: "o/r (/x)" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.provider).toBe("skills");
    expect(p.spec.display).toBe("npx -y skills add o/r -g -y");
    expect(p.spec.argv).toEqual(["npx", "-y", "skills", "add", "o/r", "-g", "-y"]);
  });

  test("interactive omite flag de confirmación del skills CLI", () => {
    const p = planInstall({ repo: "o/r", interactive: true });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.display).toBe("npx -y skills add o/r -g");
    expect(p.spec.argv).toEqual(["npx", "-y", "skills", "add", "o/r", "-g"]);
  });

  test("proyecta -a -s --copy", () => {
    const p = planInstall({
      repo: "o/r",
      agents: ["claude-code", "cursor"],
      skills: ["foo"],
      copy: true,
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.argv).toEqual([
      "npx",
      "-y",
      "skills",
      "add",
      "o/r",
      "-g",
      "-s",
      "foo",
      "-a",
      "claude-code",
      "-a",
      "cursor",
      "--copy",
      "-y",
    ]);
  });

  test("--all no añade -y extra (ya lo implica el CLI)", () => {
    const p = planInstall({ repo: "o/r", all: true });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.argv).toEqual(["npx", "-y", "skills", "add", "o/r", "-g", "--all"]);
  });

  test("clawhub ignora flags de skills", () => {
    const p = planInstall({
      repo: "owner/skill",
      provider: "clawhub",
      agents: ["cursor"],
      all: true,
      copy: true,
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.provider).toBe("clawhub");
    expect(p.spec.display).toContain("clawhub install owner/skill");
    expect(p.spec.argv).not.toContain("-a");
    expect(p.spec.argv).not.toContain("--all");
    expect(p.spec.argv).not.toContain("--copy");
  });

  test("error sin repo válido para skills", () => {
    const p = planInstall({ repo: "nope" });
    expect(p.ok).toBe(false);
  });
});

describe("planUninstall", () => {
  test("skills remove por nombre", () => {
    const p = planUninstall({ name: "hono" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.display).toBe("npx -y skills remove hono -g -y");
  });

  test("proyecta -a", () => {
    const p = planUninstall({ name: "hono", agents: ["cursor"] });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.argv).toEqual([
      "npx",
      "-y",
      "skills",
      "remove",
      "hono",
      "-g",
      "-a",
      "cursor",
      "-y",
    ]);
  });

  test("--all", () => {
    const p = planUninstall({ name: "", all: true });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.argv).toEqual(["npx", "-y", "skills", "remove", "-g", "--all"]);
  });

  test("clawhub uninstall", () => {
    const p = planUninstall({ name: "skill", repo: "owner/skill", provider: "clawhub" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.display).toContain("clawhub uninstall owner/skill");
  });
});

describe("planUpdate", () => {
  test("update global all", () => {
    const p = planUpdate({});
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.argv).toEqual(["npx", "-y", "skills", "update", "-g", "-y"]);
  });

  test("update named", () => {
    const p = planUpdate({ names: ["foo", "bar"] });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.argv).toEqual(["npx", "-y", "skills", "update", "foo", "bar", "-g", "-y"]);
  });
});

describe("planRepair", () => {
  test("re-add con -s y -a", () => {
    const p = planRepair({
      source: "acme/skills",
      skill: "demo",
      agents: ["claude-code"],
    });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.spec.argv).toEqual([
      "npx",
      "-y",
      "skills",
      "add",
      "acme/skills",
      "-g",
      "-s",
      "demo",
      "-a",
      "claude-code",
      "-y",
    ]);
  });

  test("rechaza source local", () => {
    const p = planRepair({
      source: "/Users/me/.agents/skills/demo",
      skill: "demo",
      agents: ["cursor"],
    });
    expect(p.ok).toBe(false);
  });
});

describe("installSkill / uninstallSkill spawn", () => {
  test("install invoca el argv planificado (sin tocar FS)", async () => {
    const calls: string[][] = [];
    const result = await installSkill({
      repo: "acme/demo",
      spawn: async (argv) => {
        calls.push(argv);
        return { exit: 0, stdout: "ok", stderr: "" };
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["npx", "-y", "skills", "add", "acme/demo", "-g", "-y"]]);
  });

  test("uninstall invoca skills remove (sin tocar FS)", async () => {
    const calls: string[][] = [];
    const result = await uninstallSkill({
      name: "demo",
      spawn: async (argv) => {
        calls.push(argv);
        return { exit: 0, stdout: "removed", stderr: "" };
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([["npx", "-y", "skills", "remove", "demo", "-g", "-y"]]);
  });

  test("clawhub hace fallback a npx si el binario local falla", async () => {
    const calls: string[][] = [];
    const result = await installSkill({
      repo: "owner/skill",
      provider: "clawhub",
      spawn: async (argv) => {
        calls.push(argv);
        if (argv[0] === "clawhub") return { exit: 127, stdout: "", stderr: "not found" };
        return { exit: 0, stdout: "ok", stderr: "" };
      },
    });
    expect(result.ok).toBe(true);
    expect(calls[0]![0]).toBe("clawhub");
    expect(calls[1]![0]).toBe("npx");
    expect(calls[1]).toContain("clawhub@latest");
  });

  test("propaga fallo real de skills (no borra carpetas)", async () => {
    const result = await uninstallSkill({
      name: "missing",
      spawn: async () => ({ exit: 1, stdout: "", stderr: "skill not found" }),
    });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("skill not found");
  });
});
