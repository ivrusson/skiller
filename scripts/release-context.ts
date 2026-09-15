#!/usr/bin/env bun
/**
 * Collect release context for the prepare-release skill.
 * Prints JSON to stdout. Does not bump versions or write tags.
 */
import { $ } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

async function git(args: string[]): Promise<string> {
  const result = await $`git ${args}`.cwd(root).quiet().nothrow();
  if (result.exitCode !== 0) {
    return "";
  }
  return result.stdout.toString().trim();
}

async function main() {
  const currentVersion = packageVersion();
  const head = await git(["rev-parse", "HEAD"]);
  const headShort = await git(["rev-parse", "--short=7", "HEAD"]);
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const lastTag =
    (await git(["describe", "--tags", "--abbrev=0"])) ||
    (await git(["tag", "-l", "v*", "--sort=-v:refname"])).split("\n").filter(Boolean)[0] ||
    "";

  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const logFormat = "%H%x09%h%x09%s%x09%an%x09%aI";
  const logRaw = lastTag
    ? await git(["log", range, `--format=${logFormat}`])
    : await git(["log", `--format=${logFormat}`, "-50"]);

  const commits = logRaw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, short, subject, author, date] = line.split("\t");
      return { hash, short, subject, author, date };
    });

  const filesChanged = lastTag
    ? (await git(["diff", "--name-status", range])).split("\n").filter(Boolean)
    : (await git(["diff", "--name-status", "HEAD~50..HEAD"])).split("\n").filter(Boolean);

  const dirty = (await git(["status", "--porcelain"])).split("\n").filter(Boolean);

  const out = {
    packageName: "skiller",
    currentVersion,
    lastTag: lastTag || null,
    range,
    head,
    headShort,
    branch,
    dirty: dirty.length > 0,
    dirtyFiles: dirty,
    commits,
    filesChanged,
    suggestedSlug: headShort.slice(0, 6) || "draft",
  };

  console.log(JSON.stringify(out, null, 2));
}

await main();
