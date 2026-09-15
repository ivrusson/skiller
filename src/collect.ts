import { scanAll, type SkillInfo } from "./scan";
import { enrich, type RegistryMatch } from "./registry";
import { assessTrust, type TrustAssessment } from "./providers/trust";
import { autoTags, loadTags, manualTagsFor } from "./tags";
import { getSkillUsage } from "./usage";
import { buildRelations, type SkillRelations } from "./relations";

export type WithMeta = SkillInfo & {
  registry: RegistryMatch | null;
  autoTags: string[];
  manualTags: string[];
  tags: string[];
  usage: ReturnType<typeof getSkillUsage>;
  trust: TrustAssessment;
  related: SkillRelations;
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
  opts: { refresh?: boolean; registry?: boolean } = {},
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
  return skills.map((s) => {
    const manual = manualTagsFor(s.name, tagMap);
    const auto = autoTags(s);
    const reg = registry[s.name] ?? null;
    return {
      ...s,
      registry: reg,
      autoTags: auto,
      manualTags: manual,
      tags: [...new Set([...manual, ...auto])],
      usage: getSkillUsage(s.name),
      trust: trustForInstalled(reg),
      related: relations.get(s.name) ?? { repo: null, owner: null, siblings: [], sameOwner: [] },
    };
  });
}
