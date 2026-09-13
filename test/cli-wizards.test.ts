import { describe, expect, test } from "bun:test";
import { canUseTui } from "../src/cli/tui";
import { confirmCommand } from "../src/cli/wizards";

describe("cli tui helpers", () => {
  test("canUseTui is false under bun test (no TTY)", () => {
    expect(canUseTui()).toBe(false);
  });

  test("confirmCommand --yes skips prompt", async () => {
    expect(await confirmCommand({ title: "t", command: "echo ok", yes: true })).toBe(true);
  });

  test("confirmCommand without TTY and without --yes fails", async () => {
    expect(await confirmCommand({ title: "t", command: "echo ok" })).toBe(false);
  });
});
