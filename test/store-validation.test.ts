import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAction } from "../src/core/action.ts";
import { FileActionStore } from "../src/core/store.ts";

test("valid JSON with corrupt approval data fails closed and is not overwritten", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slacki-corrupt-"));
  const file = join(dir, "actions.json");
  try {
    const action = createAction(
      {
        type: "message.send",
        workspace: "https://example.slack.com",
        target: "#engineering",
        parameters: { text: "hi" },
      },
      { id: "agent", source: "AI_AGENT" },
    );
    const states = [
      {
        version: 1,
        actions: [{ ...action, status: "PENDING_APPROVAL", approval: { expiresAt: "not-a-date" } }],
        events: [],
      },
      {
        version: 1,
        actions: [
          {
            ...action,
            status: "APPROVED",
            approval: { expiresAt: new Date().toISOString(), by: action.actor, revision: 1 },
          },
        ],
        events: [],
      },
      { version: 1, actions: [{ ...action, requestHash: "0".repeat(64) }], events: [] },
      { version: 1, actions: [action, action], events: [] },
    ];
    for (const state of states) {
      const original = JSON.stringify(state);
      await writeFile(file, original, { mode: 0o600 });
      await expect(new FileActionStore(file).transaction((s) => s.actions)).rejects.toThrow(
        "corrupt",
      );
      expect(await readFile(file, "utf8")).toBe(original);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
