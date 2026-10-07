import { Command } from "commander";
import { getPackageVersion } from "./lib/version.ts";
import { createCliContext } from "./cli/context.ts";
import { registerAuthCommand } from "./cli/auth-command.ts";
import { registerCanvasCommand } from "./cli/canvas-command.ts";
import { registerMessageCommand } from "./cli/message-command.ts";
import { registerSearchCommand } from "./cli/search-command.ts";
import { registerLaterCommand } from "./cli/later-command.ts";
import { registerUnreadsCommand } from "./cli/unreads-command.ts";
import { registerUpdateCommand } from "./cli/update-command.ts";
import { registerUserCommand } from "./cli/user-command.ts";
import { registerChannelCommand } from "./cli/channel-command.ts";
import { registerWorkflowCommand } from "./cli/workflow-command.ts";
import { registerDoctorCommand } from "./cli/doctor-command.ts";
import { registerUiCommand } from "./cli/ui-command.ts";
import { backgroundUpdateCheck } from "./lib/update.ts";
import { isSafeModeEnabled } from "./cli/safe-mode.ts";

const program = new Command();
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

function getCommandTimeoutMs(): number {
  const raw = process.env.SLACKI_COMMAND_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}

function shouldStartCommandWatchdog(args: string[]): boolean {
  const [command, subcommand] = args;
  if (!command || command === "update" || command === "ui") {
    return false;
  }
  // These commands block on an interactive editor that a human may take
  // longer than the watchdog window to interact with.
  if (command === "message" && (subcommand === "draft" || subcommand === "compose")) {
    return false;
  }
  // In safe mode "message send" redirects to the same interactive editor,
  // so the watchdog must not kill it before a human sends from the browser.
  if (command === "message" && subcommand === "send" && isSafeModeEnabled()) {
    return false;
  }
  return true;
}

function startCommandWatchdog(args: string[]): void {
  if (!shouldStartCommandWatchdog(args)) {
    return;
  }
  const timeoutMs = getCommandTimeoutMs();
  const timer = setTimeout(() => {
    console.error(
      `slacki command timed out after ${timeoutMs}ms. Set SLACKI_COMMAND_TIMEOUT_MS to adjust.`,
    );
    process.exit(124);
  }, timeoutMs);
  (timer as { unref?: () => void }).unref?.();
}

program
  .name("slacki")
  .description("Slack automation CLI for AI agents")
  .version(getPackageVersion())
  .option(
    "--safe-mode",
    'Human-in-the-loop enforcement: redirect "message send" to the draft editor and block other Slack mutations (also: SLACKI_SAFE_MODE=1)',
  );

startCommandWatchdog(process.argv.slice(2));

const ctx = createCliContext();

registerAuthCommand({ program, ctx });
registerDoctorCommand({ program, ctx });
registerUiCommand({ program, ctx });
registerMessageCommand({ program, ctx });
registerCanvasCommand({ program, ctx });
registerSearchCommand({ program, ctx });
registerLaterCommand({ program, ctx });
registerUnreadsCommand({ program, ctx });
registerUpdateCommand({ program });
registerUserCommand({ program, ctx });
registerChannelCommand({ program, ctx });
registerWorkflowCommand({ program, ctx });

program.parse(process.argv);
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

// Fire-and-forget background update check (throttled to once/24h, stderr only).
// Skip for the update command itself to avoid duplicate output.
const [subcommand] = process.argv.slice(2);
if (subcommand && subcommand !== "update") {
  backgroundUpdateCheck();
}
