import { expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerActionCommand } from "../src/cli/action-command.ts";
import { controlFixture } from "./support/control-fixture.ts";
import type { Action } from "../src/core/action.ts";

test("Commander CLI: agent request, inspect, edit, approve and durable history", async () => {
  const fixture = controlFixture();
  const directory = await mkdtemp(join(tmpdir(), "slacki-cli-"));
  const previous = process.env.SLACKI_CONTROL_DIR;
  process.env.SLACKI_CONTROL_DIR = directory;
  const original = console.log;
  let output = "";
  console.log = (value) => {
    output = String(value);
  };
  async function run(args: string[]) {
    const program = new Command();
    registerActionCommand({ program, ctx: fixture.ctx });
    await program.parseAsync(["bun", "slacki", ...args]);
    return JSON.parse(output);
  }
  try {
    const file = join(directory, "request.json");
    await writeFile(
      file,
      JSON.stringify({
        type: "message.send",
        workspace: fixture.workspace,
        target: "#engineering",
        parameters: { text: "Deployment failed" },
        key: "cli-deployment",
      }),
    );
    const preview = await run(["action", "request", file, "--dry-run"]);
    expect(preview.dryRun).toBe(true);
    const pending = (await run(["action", "request", file])) as Action;
    expect(pending.actor.source).toBe("AI_AGENT");
    expect(pending.status).toBe("PENDING_APPROVAL");
    expect((await run(["action", "get", pending.id])).id).toBe(pending.id);
    await run([
      "action",
      "edit",
      pending.id,
      "--revision",
      "1",
      "--text",
      "Deployment failed. Rollback started.",
    ]);
    const done = await run(["action", "approve", pending.id, "--revision", "2"]);
    expect(done.status).toBe("SUCCESS");
    expect(fixture.calls.filter((c) => c.method === "chat.postMessage")).toHaveLength(1);
    const events = await run(["action", "activity", pending.id]);
    expect(events.map((e: { event: string }) => e.event)).toContain("execution-finished");
    const replay = await run(["action", "request", file]);
    expect(replay.id).toBe(pending.id);
    expect(replay.status).toBe("SUCCESS");
    const workflowFile = join(directory, "workflow.json");
    await writeFile(
      workflowFile,
      JSON.stringify({
        id: "cli-history",
        steps: [
          {
            id: "notify",
            action: {
              type: "message.send",
              workspace: fixture.workspace,
              target: "#engineering",
              parameters: { text: "Workflow history fixture" },
            },
          },
        ],
      }),
    );
    const workflow = await run(["automation", "run", workflowFile, "--run-key", "incident"]);
    expect(workflow.status).toBe("PAUSED");
    expect((await run(["automation", "list"]))[0].id).toBe(workflow.runId);
    expect((await run(["automation", "get", workflow.runId])).actions[0].status).toBe(
      "PENDING_APPROVAL",
    );
  } finally {
    console.log = original;
    if (previous === undefined) {
      delete process.env.SLACKI_CONTROL_DIR;
    } else {
      process.env.SLACKI_CONTROL_DIR = previous;
    }
    fixture.restore();
    await rm(directory, { recursive: true, force: true });
  }
});
