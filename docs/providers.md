# Providers

Explore (`skiller explore` / web **Explore** tab) queries these catalogs in parallel. Each result is normalized to a remote skill, deduped, scored, and marked if already installed.

| Provider            | Module                          | Data source                        |
| ------------------- | ------------------------------- | ---------------------------------- |
| skills.sh           | `src/providers/skills-sh.ts`    | `https://skills.sh/api/search`     |
| Claude marketplaces | `src/providers/marketplaces.ts` | GitHub `marketplace.json` catalogs |
| SkillsMP            | `src/providers/skillsmp.ts`     | Public paginated SkillsMP API      |
| Awesome lists       | `src/providers/awesome.ts`      | Parsed README tables/lists         |
| ClawHub             | `src/providers/clawhub.ts`      | `clawhub search` / `npx clawhub`   |

Caches: `~/.skiller/cache/providers/<id>.json`. Refresh with Explore **Refresh catalogs** or `skiller cache --clear-providers` then search again.

Install routing (not Explore itself): default `npx skills add|remove`; ClawHub rows use `clawhub` / `npx clawhub`. See `src/install.ts` and [LEGENDS.md](../LEGENDS.md).
