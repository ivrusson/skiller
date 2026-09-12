import { cacheFresh, readCache, writeCache } from "./cache";
import { repoFromGitHubUrl, type Fetcher, type Provider, type RemoteSkill } from "./types";

const TTL_MS = 24 * 60 * 60 * 1000;

interface AwesomeSource {
  repo: string;
  raw: string;
  kind: "table" | "list";
}

// Discovery indices maintained by the community. Format verified 2026-09-12.
const SOURCES: AwesomeSource[] = [
  { repo: "travisvn/awesome-claude-skills", raw: "https://raw.githubusercontent.com/travisvn/awesome-claude-skills/main/README.md", kind: "table" },
  { repo: "hesreallyhim/awesome-claude-code", raw: "https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/README.md", kind: "list" },
];

// | **[name](https://github.com/o/r)** | description |
const TABLE_RE = /\|\s*\*\*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\*\*\s*\|([^|]*)\|/;
// - [Name](https://github.com/o/r) by [Author](...) - description
const LIST_RE = /^-\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(?:by\s*\[[^\]]+\]\([^)]*\)\s*)?[-–—:]?\s*(.*)$/;

function parseTable(markdown: string): RemoteSkill[] {
  const out: RemoteSkill[] = [];
  for (const line of markdown.split("\n")) {
    const m = TABLE_RE.exec(line);
    if (!m) continue;
    const url = m[2]!;
    if (!url.includes("github.com")) continue;
    out.push({
      name: m[1]!.trim(),
      description: m[3]!.trim(),
      url,
      provider: "awesome",
      repo: repoFromGitHubUrl(url),
    });
  }
  return out;
}

function parseList(markdown: string): RemoteSkill[] {
  const out: RemoteSkill[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("- [")) continue;
    const m = LIST_RE.exec(line);
    if (!m) continue;
    const url = m[2]!;
    if (!url.includes("github.com")) continue;
    out.push({
      name: m[1]!.trim(),
      description: m[3]!.trim(),
      url,
      provider: "awesome",
      repo: repoFromGitHubUrl(url),
    });
  }
  return out;
}

async function syncCatalog(fetcher: Fetcher): Promise<RemoteSkill[]> {
  const settled = await Promise.all(
    SOURCES.map(async (s) => {
      const res = await fetcher(s.raw, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${s.repo} HTTP ${res.status}`);
      const markdown = await res.text();
      return s.kind === "table" ? parseTable(markdown) : parseList(markdown);
    }),
  );
  const out = settled.flat();
  if (!out.length) throw new Error("no awesome-list reachable");
  return out;
}

function matches(skill: RemoteSkill, q: string): boolean {
  const hay = (skill.name + " " + skill.description).toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

export const awesomeProvider: Provider = {
  id: "awesome",
  label: "Awesome lists",

  async search(query, fetcher = fetch): Promise<RemoteSkill[]> {
    const term = query.trim();
    if (!term) return [];
    const cached = readCache<RemoteSkill[]>("awesome");
    let catalog = cacheFresh("awesome", TTL_MS) && cached ? cached : null;
    if (!catalog) {
      try {
        catalog = await syncCatalog(fetcher);
        writeCache("awesome", catalog);
      } catch {
        catalog = cached ?? [];
      }
    }
    return catalog.filter((s) => matches(s, term));
  },
};
