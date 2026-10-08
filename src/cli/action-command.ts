import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { CliContext } from "./context.ts";
import { createActionService, loadPolicy } from "../core/runtime.ts";
import { isSafeModeEnabledFor } from "./safe-mode.ts";
import { sanitize } from "../core/store.ts";
import { planNotification } from "../core/planner.ts";
import { runLocalWorkflow } from "../core/workflow.ts";

export async function readInput(path: string): Promise<unknown> {
  return JSON.parse(path === "-" ? readFileSync(0, "utf8") : await readFile(path, "utf8"));
}
export function registerActionCommand(input: { program: Command; ctx: CliContext }): void {
  const service = () =>
    createActionService(input.ctx, { safeMode: isSafeModeEnabledFor(input.program) });
  const output = (work: () => Promise<unknown>) => async () => {
    try {
      console.log(JSON.stringify(await work(), null, 2));
    } catch (error) {
      console.error(sanitize(input.ctx.errorMessage(error)));
      process.exitCode = 1;
    }
  };
  const action = input.program
    .command("action")
    .description("Request, inspect and review controlled Slack actions");
  action
    .command("list")
    .description("List local action history")
    .action(output(() => service().list()));
  action
    .command("get <id>")
    .description("Inspect a stored action")
    .action((id) => output(() => service().get(id))());
  action
    .command("activity [id]")
    .description("Inspect lifecycle events")
    .action((id) => output(() => service().events(id))());
  action
    .command("request <file>")
    .description("Submit a strict JSON action (use - for stdin); agent identity by default")
    .option("--actor <id>", "Requester label", "cli-agent")
    .option("--human", "Trusted local human CLI request")
    .option("--dry-run", "Resolve context and policy without Slack mutations")
    .action((file, options) =>
      output(async () => {
        const actor = {
          id: options.actor,
          source: options.human ? ("HUMAN_CLI" as const) : ("AI_AGENT" as const),
        };
        const value = await readInput(file);
        return options.dryRun ? service().preview(value, actor) : service().request(value, actor);
      })(),
    );
  for (const operation of ["approve", "reject", "edit"] as const) {
    const cmd = action
      .command(`${operation} <id>`)
      .description(`${operation} a pending action; trusted local operator only`)
      .requiredOption("--revision <n>", "Exact revision inspected by the reviewer");
    if (operation === "edit") {
      cmd.requiredOption("--text <text>", "Replacement text; destination cannot change");
    }
    cmd.action((id, options) =>
      output(() =>
        service().review(id, {
          operation,
          revision: Number(options.revision),
          text: options.text,
          authority: { actor: { id: "local-operator", source: "HUMAN_CLI" }, canApprove: true },
        }),
      )(),
    );
  }
  const policy = input.program.command("policy").description("Inspect the effective local policy");
  policy
    .command("list")
    .description("Show configuration; built-in safe defaults also apply")
    .action(output(loadPolicy));
  policy
    .command("check <file>")
    .description("Resolve a proposed agent action and explain policy (no mutation)")
    .action((file) =>
      output(async () =>
        service().preview(await readInput(file), { id: "policy-check", source: "AI_AGENT" }),
      )(),
    );
  input.program
    .command("plan <file>")
    .description(
      "Create a notification plan from intent and explicit destination/content JSON; never executes",
    )
    .action((file) => output(async () => planNotification(await readInput(file)))());
  const automation = input.program
    .command("automation")
    .description(
      "Run local deterministic workflows (Slack-native workflow commands remain available)",
    );
  automation
    .command("run <file>")
    .requiredOption(
      "--run-key <key>",
      "Stable execution key; reuse to resume, change for a new run",
    )
    .option("--dry-run", "Preview all applicable steps; no Slack mutation")
    .action((file, options) =>
      output(async () =>
        runLocalWorkflow(service(), {
          plan: await readInput(file),
          runKey: options.runKey,
          actor: { id: "local-workflow", source: "WORKFLOW" },
          dryRun: options.dryRun,
        }),
      )(),
    );
}
