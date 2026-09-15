---
name: prepare-release
description: >-
  Prepare a skiller GitHub release draft. Use when the user asks to prepare a
  release, bump the version, write a changelog, or get ready to push a v* tag.
  Writes a draft under .releases/ (gitignored); never creates or pushes tags.
---

# Prepare release

Create a **local** release draft for skiller. Tags stay manual.

## Hard rules

1. Run `bun run release:context` first and use that JSON as ground truth.
2. Write **one** file: `.releases/v{VERSION}-{slug}.md` (create `.releases/` if needed).
3. **Do not** `git commit`, **do not** create/push tags, **do not** force-add `.releases/` to git.
4. **Do not** change `package.json` version unless the user explicitly asks in the same turn.
5. After writing the file, show the path and the suggested tag commands. Stop.

## Version bump

From commits since `lastTag` (or all recent commits if no tag):

| Signal in commits / changes                                | Bump    |
| ---------------------------------------------------------- | ------- |
| `BREAKING CHANGE` / `!:` / incompatible API or CLI removal | `major` |
| `feat:` or user-visible capability                         | `minor` |
| `fix:`, docs, chore, CI, refactor with no API change       | `patch` |

- Previous version = `lastTag` without `v` if present, else `currentVersion` from context.
- Next version = semver bump of that previous version.
- `slug` = `suggestedSlug` from context (short HEAD hash), unless the user names one.

## File template

```markdown
# skiller v{VERSION}

## Meta

- bump: {major|minor|patch}
- previous: {PREV}
- version: {VERSION}
- tag: v{VERSION}
- based_on: {headShort}

## Changelog

### Features

- ...

### Fixes

- ...

### Notes

- ...

## Before tagging

1. Set "version" in package.json to {VERSION} (commit if desired)
2. bun test && bun run lint && bun run fmt:check

## Publish tag

git tag -a v{VERSION} -m "v{VERSION}"
git push origin v{VERSION}

## After tag

GitHub Actions `release.yml` builds binaries and creates the GitHub Release.
Paste the Changelog section as release notes if the auto-generated body is thin.

## Release notes (for GitHub)

{same changelog, ready to paste}
```

Omit empty changelog subsections. Prefer concrete bullets from commit subjects (rewrite for humans; drop noise like `merge branch`).

## Done when

- `.releases/v{VERSION}-{slug}.md` exists
- User has the tag commands
- Working tree otherwise untouched by this skill
