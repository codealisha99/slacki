import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import type { CliContext } from "../src/cli/context.ts";
import { registerAuthCommand } from "../src/cli/auth-command.ts";
import { registerCanvasCommand } from "../src/cli/canvas-command.ts";
import { registerChannelCommand } from "../src/cli/channel-command.ts";
import { registerDoctorCommand } from "../src/cli/doctor-command.ts";
import { registerLaterCommand } from "../src/cli/later-command.ts";
import { registerMessageCommand } from "../src/cli/message-command.ts";
import { registerSearchCommand } from "../src/cli/search-command.ts";
import { registerUnreadsCommand } from "../src/cli/unreads-command.ts";
import { registerUpdateCommand } from "../src/cli/update-command.ts";
import { registerUserCommand } from "../src/cli/user-command.ts";
import { registerWorkflowCommand } from "../src/cli/workflow-command.ts";
import { registerUiCommand } from "../src/cli/ui-command.ts";
import { SAFE_MODE_BLOCKED_COMMANDS } from "../src/cli/safe-mode.ts";

function collectCommandPaths(root: Command, prefix: string[] = []): string[] {
  const paths: string[] = [];
  for (const child of root.commands) {
    const next = [...prefix, child.name()];
    paths.push(next.join(" "));
    paths.push(...collectCommandPaths(child, next));
  }
  return paths;
}

function buildProgram(): Command {
  const program = new Command();
  const ctx = {} as CliContext;
  program.option("--safe-mode");
  registerAuthCommand({ program, ctx });
  registerDoctorCommand({ program, ctx });
  registerMessageCommand({ program, ctx });
  registerCanvasCommand({ program, ctx });
  registerSearchCommand({ program, ctx });
  registerLaterCommand({ program, ctx });
  registerUnreadsCommand({ program, ctx });
  registerUiCommand({ program, ctx });
  registerUpdateCommand({ program });
  registerUserCommand({ program, ctx });
  registerChannelCommand({ program, ctx });
  registerWorkflowCommand({ program, ctx });
  return program;
}

const EXPECTED_COMMANDS = [
  "auth",
  "auth add",
  "auth import-brave",
  "auth import-chrome",
  "auth import-desktop",
  "auth import-firefox",
  "auth parse-curl",
  "auth remove",
  "auth set-default",
  "auth test",
  "auth whoami",
  "canvas",
  "canvas create",
  "canvas get",
  "channel",
  "channel invite",
  "channel list",
  "channel mark",
  "channel new",
  "doctor",
  "later",
  "later archive",
  "later complete",
  "later list",
  "later remind",
  "later remove",
  "later reopen",
  "later save",
  "message",
  "message compose",
  "message delete",
  "message draft",
  "message draft create",
  "message draft delete",
  "message draft list",
  "message draft update",
  "message edit",
  "message get",
  "message list",
  "message react",
  "message react add",
  "message react remove",
  "message scheduled",
  "message scheduled cancel",
  "message scheduled list",
  "message send",
  "search",
  "search all",
  "search files",
  "search messages",
  "ui",
  "unreads",
  "update",
  "user",
  "user dm-open",
  "user get",
  "user list",
  "workflow",
  "workflow get",
  "workflow list",
  "workflow preview",
  "workflow run",
];

describe("public CLI command tree", () => {
  test("matches the documented command set (update this list when adding a verb)", () => {
    const paths = collectCommandPaths(buildProgram()).sort();
    expect(paths).toEqual(EXPECTED_COMMANDS);
  });

  test("every safe-mode blocked command exists on the tree", () => {
    const paths = new Set(collectCommandPaths(buildProgram()));
    for (const command of SAFE_MODE_BLOCKED_COMMANDS) {
      expect(paths.has(command)).toBe(true);
    }
  });
});
