import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetPathsState } from "../src/paths";
import { addTags, autoTags, loadTags, removeTags } from "../src/tags";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "skiller-tags-"));
  process.env.SKILLER_HOME = dir;
  resetPathsState();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.SKILLER_HOME;
  resetPathsState();
});

describe("autoTags", () => {
  test("clasifica por contenido", () => {
    expect(
      autoTags({ name: "tdd", description: "Test-driven development. Use when writing tests first", summary: "" }),
    ).toContain("testing");
    expect(
      autoTags({ name: "hono", description: "Develop Hono applications. API reference lookup", summary: "" }),
    ).toContain("backend");
    expect(autoTags({ name: "zz-sin-clase", description: "cosas varias sin clasificar", summary: "" })).toEqual([]);
  });

  test("un skill puede tener varios tags y respeta el máximo", () => {
    const tags = autoTags({
      name: "vercel-react-best-practices",
      description: "React and Next.js performance optimization guidelines",
      summary: "",
    });
    expect(tags).toContain("frontend");
    expect(tags.length).toBeLessThanOrEqual(4);
  });

  test("no confunde 'review' con 'preview'", () => {
    expect(autoTags({ name: "preview", description: "Preview things before publishing", summary: "" })).not.toContain("review");
    expect(autoTags({ name: "code-review", description: "Review the changes since a commit", summary: "" })).toContain("review");
  });

  test("no etiqueta frontend por mencionar 'ui' suelto", () => {
    expect(
      autoTags({ name: "dokploy-api-mcp", description: "Deploy and manage applications on Dokploy (self-hosted PaaS)", summary: "" }),
    ).not.toContain("frontend");
  });

  test("'skill' en el cuerpo no basta para agentes-ia; en el nombre sí", () => {
    expect(autoTags({ name: "tdd", description: "Use this skill when writing tests first", summary: "" })).not.toContain("ai-agents");
    expect(autoTags({ name: "skill-creator", description: "Create new skills and run evals", summary: "" })).toContain("ai-agents");
  });
});

describe("tags manuales", () => {
  test("añadir, listar y quitar (roundtrip en disco)", () => {
    addTags("hono", ["favorito", "backend"]);
    expect(loadTags()["hono"]).toEqual(["favorito", "backend"]);
    removeTags("hono", ["favorito"]);
    expect(loadTags()["hono"]).toEqual(["backend"]);
    removeTags("hono", ["backend"]);
    expect(loadTags()["hono"]).toBeUndefined();
  });

  test("no duplica tags (insensible a mayúsculas)", () => {
    addTags("hono", ["Favorito"]);
    addTags("hono", ["favorito", "favorito"]);
    expect(loadTags()["hono"]).toEqual(["Favorito"]);
  });

  test("ignora tags vacíos y normaliza espacios", () => {
    addTags("hono", ["", "   ", "  para  revisar  "]);
    expect(loadTags()["hono"]).toEqual(["para revisar"]);
  });
});
