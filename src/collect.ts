import { scanAll, type SkillInfo } from "./scan";
import { enrich, type RegistryMatch } from "./registry";
import { assessTrust, type TrustAssessment } from "./providers/trust";
import { autoTags, loadTags, manualTagsFor } from "./tags";
import { getSkillUsage } from "./usage";
import { buildRelations, type SkillRelations } from "./relations";
import { fetchSkillsListGlobal, indexByName } from "./skills-cli";

export type WithMeta = SkillInfo & {
  registry: RegistryMatch | null;
  autoTags: string[];
  manualTags: string[];
  tags: string[];
  usage: ReturnType<typeof getSkillUsage>;
  trust: TrustAssessment;
  related: SkillRelations;
  /** Agent coverage from `skills list -g --json` (display names). */
  agents: string[];
  /** Lock source from skills CLI when available (often owner/repo). */
  skillsSource: string | null;
};

function trustForInstalled(registry: RegistryMatch | null): TrustAssessment {
  if (!registry) {
    return assessTrust({ provider: "local" });
  }
  return assessTrust({
    provider: "skills.sh",
    repo: registry.source || registry.id,
    installs: registry.installs,
  });
}

export async function collect(
  opts: {
    refresh?: boolean;
    registry?: boolean;
    /** Overlay agents from `skills list -g --json`. Default true. */ skillsList?: boolean;
  } = {},
): Promise<WithMeta[]> {
  const skills = scanAll();
  const registry =
    opts.registry === false
      ? {}
      : await enrich(
          skills.map((s) => s.name),
          { refresh: opts.refresh },
        );
  const tagMap = loadTags();
  const relations = buildRelations(
    skills.map((s) => ({ name: s.name, source: registry[s.name]?.source ?? registry[s.name]?.id })),
  );

  let skillsIndex = new Map<string, { agents: string[]; source: string }>();
  // Under SKILLER_HOME (tests), skip the live `npx skills list` spawn unless
  // the caller opts in with skillsList: true (and usually a mocked spawn via cache).
  const wantList =
    opts.skillsList === true || (opts.skillsList !== false && !process.env.SKILLER_HOME);
  if (wantList) {
    const listed = await fetchSkillsListGlobal({ refresh: opts.refresh });
    if (listed.ok) {
      skillsIndex = indexByName(listed.entries);
    }
  }

  return skills.map((s) => {
    const manual = manualTagsFor(s.name, tagMap);
    const auto = autoTags(s);
    const reg = registry[s.name] ?? null;
    const coverage = skillsIndex.get(s.name.toLowerCase());
    return {
      ...s,
      registry: reg,
      autoTags: auto,
      manualTags: manual,
      tags: [...new Set([...manual, ...auto])],
      usage: getSkillUsage(s.name),
      trust: trustForInstalled(reg),
      related: relations.get(s.name) ?? { repo: null, owner: null, siblings: [], sameOwner: [] },
      agents: coverage?.agents ?? [],
      skillsSource: coverage?.source ?? null,
    };
  });
}
