import { describe, expect, test } from "bun:test";
import {
  extractHeadings,
  extractSummary,
  parseFrontmatter,
  scanSkill,
  type SkillSource,
} from "../src/scan";

describe("parseFrontmatter", () => {
  test("parsea name y description", () => {
    const md = `---\nname: hono\ndescription: Develop Hono apps\n---\n\n# Body\n`;
    const { data, body } = parseFrontmatter(md);
    expect(data.name).toBe("hono");
    expect(data.description).toBe("Develop Hono apps");
    expect(body.startsWith("\n# Body")).toBe(true);
  });

  test("une valores multilinea", () => {
    const md = `---\nname: x\ndescription: primera linea\n  segunda linea\n---\n`;
    const { data } = parseFrontmatter(md);
    expect(data.description).toBe("primera linea segunda linea");
  });

  test("sin frontmatter devuelve body intacto", () => {
    const { data, body } = parseFrontmatter("# solo body");
    expect(data).toEqual({});
    expect(body).toBe("# solo body");
  });

  test("quita comillas simples y dobles", () => {
    const { data } = parseFrontmatter(`---\nname: 'a'\ndescription: "b"\n---\n`);
    expect(data.name).toBe("a");
    expect(data.description).toBe("b");
  });

  test("parsea bloques YAML doblados (>-) y literales (|-)", () => {
    const md = `---\nname: x\ndescription: >-\n  Primera linea\n  segunda linea\nlicense: MIT\n---\n`;
    const { data } = parseFrontmatter(md);
    expect(data.description).toBe("Primera linea segunda linea");
    expect(data.license).toBe("MIT");
  });
});

describe("extractSummary", () => {
  test("toma el primer párrafo y limpia markdown", () => {
    const body = `# Título\n\nEsto es un **resumen** con [\`código\`](http://x.com) y más.\n\nSegundo párrafo.`;
    expect(extractSummary(body)).toBe("Esto es un resumen con código y más.");
  });

  test("ignora bloques de código", () => {
    const body = "```ts\nconst a = 1;\n```\n\nPárrafo real.";
    expect(extractSummary(body)).toBe("Párrafo real.");
  });
});

describe("extractHeadings", () => {
  test("extrae hasta 12 headings de nivel 2", () => {
    const body = "## Uno\ntexto\n## Dos\n## Tres";
    expect(extractHeadings(body)).toEqual(["Uno", "Dos", "Tres"]);
  });
});

describe("scanSkill", () => {
  const source: SkillSource = { root: "/tmp", scope: "user", label: "~/.agents/skills" };

  test("devuelve null sin SKILL.md", () => {
    expect(scanSkill(source, "/tmp")).toBeNull();
  });

  test("falla con gracia en un directorio inexistente", () => {
    expect(scanSkill(source, "/no/existe/para/nada")).toBeNull();
  });
});
