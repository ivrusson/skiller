import type { Provider, RemoteSkill } from "./types";

const SEARCH_TIMEOUT_MS = 45_000;
const SLUG_RE = /(?:@)?([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)/g;

async function trySearch(args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), SEARCH_TIMEOUT_MS);
    const [stdout, exit] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);
    return exit === 0 ? stdout : null;
  } catch {
    return null;
  }
}

export function parseClawhubOutput(output: string): RemoteSkill[] {
  const seen = new Set<string>();
  const out: RemoteSkill[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    SLUG_RE.lastIndex = 0;
    const m = SLUG_RE.exec(line);
    if (!m) continue;
    const slug = m[1]!;
    const key = slug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const name = slug.split("/")[1]!;
    const description = line.replace(m[0], "").replace(/^[\s│|\-–—:]+/, "").trim();
    out.push({
      name,
      description,
      url: `https://clawhub.ai/${slug}`,
      provider: "clawhub",
      repo: slug,
    });
  }
  return out;
}

function matches(skill: RemoteSkill, q: string): boolean {
  const hay = (skill.name + " " + skill.description + " " + skill.repo).toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

export const clawhubProvider: Provider = {
  id: "clawhub",
  label: "ClawHub",

  async search(query): Promise<RemoteSkill[]> {
    const term = query.trim();
    if (!term) return [];
    // Local install first (fast), fall back to npx (slow, requires network + download).
    let output = await trySearch(["clawhub", "search", term]);
    if (output === null) {
      output = await trySearch(["npx", "-y", "clawhub@latest", "search", term]);
    }
    if (output === null) return [];
    return parseClawhubOutput(output).filter((s) => matches(s, term) || s.repo?.toLowerCase().includes(term.toLowerCase()));
  },
};
