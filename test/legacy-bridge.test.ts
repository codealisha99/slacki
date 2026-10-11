import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlFixture } from "./support/control-fixture.ts";
import { controlledClient } from "../src/core/legacy-bridge.ts";
import { createActionService } from "../src/core/runtime.ts";

test("legacy message API contracts use the same policy service and preserve custom blocks", async () => {
  const fixture = controlFixture();
  const dir = await mkdtemp(join(tmpdir(), "slacki-bridge-"));
  const previous = process.env.SLACKI_CONTROL_DIR;
  process.env.SLACKI_CONTROL_DIR = dir;
  try {
    const { client } = await fixture.ctx.getClientForWorkspace(fixture.workspace);
    const controlled = controlledClient({
      client,
      rawContext: fixture.ctx,
      workspace: fixture.workspace,
      actor: { id: "operator", source: "HUMAN_CLI" },
    });
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "Block-only message" } }];
    const result = await controlled.api("chat.postMessage", {
      channel: "C01234567",
      text: "",
      blocks,
    });
    expect(result.ts).toBe("1700000000.000001");
    expect(
      JSON.parse(fixture.calls.find((c) => c.method === "chat.postMessage")!.parameters.blocks!),
    ).toEqual(blocks);
    await expect(
      controlled.api("chat.delete", { channel: "C01234567", ts: "1700000000.000001" }),
    ).rejects.toThrow("PENDING_APPROVAL");
    const actions = await createActionService(fixture.ctx).list();
    expect(actions.map((a) => a.status)).toEqual(["SUCCESS", "PENDING_APPROVAL"]);
    expect(fixture.calls.some((c) => c.method === "chat.delete")).toBe(false);
    const guarded = controlledClient({
      client,
      rawContext: fixture.ctx,
      workspace: fixture.workspace,
      actor: { id: "operator", source: "HUMAN_UI" },
      safeMode: true,
    });
    await expect(
      guarded.api("chat.postMessage", { channel: "C01234567", text: "Blocked UI send" }),
    ).rejects.toThrow("DENIED");
    expect(fixture.calls.filter((c) => c.method === "chat.postMessage")).toHaveLength(1);
  } finally {
    fixture.restore();
    if (previous === undefined) {
      delete process.env.SLACKI_CONTROL_DIR;
    } else {
      process.env.SLACKI_CONTROL_DIR = previous;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
