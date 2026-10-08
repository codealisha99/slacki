import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliContext } from "../cli/context.ts";
import { isSafeModeEnabled } from "../cli/safe-mode.ts";
import { ActionService } from "./service.ts";
import { FileActionStore } from "./store.ts";
import { slackExecution } from "./slack-execution.ts";
import { defaultPolicy, PolicySchema } from "./policy.ts";

export function controlDirectory(): string {
  return process.env.SLACKI_CONTROL_DIR || join(homedir(), ".slacki", "control");
}
export async function loadPolicy() {
  try {
    return PolicySchema.parse(
      JSON.parse(await readFile(join(controlDirectory(), "policy.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultPolicy();
    }
    throw error;
  }
}
export function createActionService(
  ctx: CliContext,
  options: { safeMode?: boolean } = {},
): ActionService {
  return new ActionService({
    store: new FileActionStore(join(controlDirectory(), "actions.json")),
    execution: slackExecution(ctx.rawContext?.() ?? ctx),
    policy: loadPolicy,
    safeMode: () => isSafeModeEnabled({ cliFlag: options.safeMode }),
  });
}
