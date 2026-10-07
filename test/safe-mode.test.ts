import { afterEach, describe, expect, mock, test } from "bun:test";
import { Command } from "commander";
import type { CliContext } from "../src/cli/context.ts";
import {
  isSafeModeEnabled,
  redirectSendToDraft,
  safeModeBlockedError,
} from "../src/cli/safe-mode.ts";
import { registerMessageCommand } from "../src/cli/message-command.ts";

const stubCtx = {} as CliContext;

describe("isSafeModeEnabled", () => {
  test("enabled via CLI flag", () => {
    expect(isSafeModeEnabled({ cliFlag: true, env: {} })).toBe(true);
  });

  test.each(["1", "true", "TRUE", "yes", "on", " 1 "])("enabled for env value %p", (value) => {
    expect(isSafeModeEnabled({ env: { SLACKI_SAFE_MODE: value } })).toBe(true);
  });

  test.each(["0", "false", "off", "no", ""])("disabled for env value %p", (value) => {
    expect(isSafeModeEnabled({ env: { SLACKI_SAFE_MODE: value } })).toBe(false);
  });

  test("disabled when env var is unset and flag is absent", () => {
    expect(isSafeModeEnabled({ env: {} })).toBe(false);
    expect(isSafeModeEnabled({ cliFlag: false, env: {} })).toBe(false);
  });
});

describe("safeModeBlockedError", () => {
  test("names the blocked action", () => {
    expect(safeModeBlockedError("message edit").message).toContain('"message edit" is blocked');
    expect(safeModeBlockedError("channel new").message).toContain('"channel new" is blocked');
    expect(safeModeBlockedError("message compose").message).toContain(
      '"message compose" is blocked',
    );
  });
});

describe("message compose safe-mode gate", () => {
  const originalEnv = process.env.SLACKI_SAFE_MODE;
  const originalExit = process.exitCode;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SLACKI_SAFE_MODE;
    } else {
      process.env.SLACKI_SAFE_MODE = originalEnv;
    }
    process.exitCode = originalExit ?? 0;
  });

  test("blocks compose in safe mode before any send happens", async () => {
    process.env.SLACKI_SAFE_MODE = "1";

    // If composeMessage were ever reached (bypassing safe mode), this context
    // would fail the test. The gate must throw before touching the network.
    const ctx = {
      withAutoRefresh: async () => {
        throw new Error("composeMessage should not run under safe mode");
      },
      getClientForWorkspace: async () => {
        throw new Error("composeMessage should not run under safe mode");
      },
      effectiveWorkspaceUrl: () => undefined,
      assertWorkspaceSpecifiedForChannelNames: async () => {},
      errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    } as unknown as CliContext;

    const program = new Command();
    registerMessageCommand({ program, ctx });
    const err = mock(() => {});
    console.error = err as typeof console.error;

    await program.parseAsync(["message", "compose", "#general", "hi"], { from: "user" });

    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0])).toContain('"message compose" is blocked');
    expect(process.exitCode).toBe(1);
  });

  test("without safe mode, compose proceeds to resolution (not gated)", async () => {
    delete process.env.SLACKI_SAFE_MODE;

    // A stub that proves the command proceeds past the gate when safe mode is
    // off (reaching the compose resolution path instead of being blocked).
    const ctx = {
      withAutoRefresh: async () => {
        throw new Error("outside-safe-mode: reached compose resolution");
      },
      getClientForWorkspace: async () => {
        throw new Error("outside-safe-mode: reached compose resolution");
      },
      effectiveWorkspaceUrl: () => undefined,
      assertWorkspaceSpecifiedForChannelNames: async () => {},
      errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
    } as unknown as CliContext;

    const program = new Command();
    registerMessageCommand({ program, ctx });
    const err = mock(() => {});
    console.error = err as typeof console.error;

    await program.parseAsync(["message", "compose", "#general", "hi"], { from: "user" });

    // Safe mode is off, so it is NOT blocked with the safe-mode error.
    expect(String(err.mock.calls ?? []).includes('"message compose" is blocked')).toBe(false);
  });
});

describe("redirectSendToDraft", () => {
  const originalCi = process.env.CI;

  afterEach(() => {
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
  });

  test.each([
    [{ attach: ["./report.md"] }, "--attach"],
    [{ blocks: "/tmp/blocks.json" }, "--blocks"],
    [{ schedule: "2030-01-01T00:00:00Z" }, "--schedule"],
    [{ scheduleIn: "3h" }, "--schedule-in"],
    [{ replyBroadcast: true }, "--reply-broadcast"],
  ])("rejects unsupported send option %p", async (options, flag) => {
    await expect(
      redirectSendToDraft({ ctx: stubCtx, targetInput: "#general", text: "hi", options }),
    ).rejects.toThrow(flag);
  });

  test("lists all unsupported flags at once", async () => {
    const promise = redirectSendToDraft({
      ctx: stubCtx,
      targetInput: "#general",
      text: "hi",
      options: { attach: ["./a.md"], scheduleIn: "3h" },
    });
    await expect(promise).rejects.toThrow("--attach, --schedule-in");
  });

  test("rejects in CI where no interactive editor is available", async () => {
    process.env.CI = "1";
    await expect(
      redirectSendToDraft({ ctx: stubCtx, targetInput: "#general", text: "hi", options: {} }),
    ).rejects.toThrow("unavailable in CI");
  });

  test("opens a draft with the send text and thread context", async () => {
    delete process.env.CI;
    const draftCalls: unknown[] = [];
    const payload = await redirectSendToDraft(
      {
        ctx: stubCtx,
        targetInput: "#general",
        text: "here's the report",
        options: { workspace: "myteam", threadTs: "1770165109.628379" },
      },
      async (input) => {
        draftCalls.push(input);
        return { ok: true, sent: true };
      },
    );
    expect(draftCalls).toEqual([
      {
        ctx: stubCtx,
        targetInput: "#general",
        initialText: "here's the report",
        options: { workspace: "myteam", threadTs: "1770165109.628379" },
      },
    ]);
    expect(payload).toEqual({
      safe_mode: true,
      redirected_from: "send",
      ok: true,
      sent: true,
    });
  });
});

function networkForbiddenCtx(): CliContext {
  const fail = async () => {
    throw new Error("safe-mode gate should not touch Slack");
  };
  return {
    withAutoRefresh: fail,
    getClientForWorkspace: fail,
    effectiveWorkspaceUrl: () => undefined,
    assertWorkspaceSpecifiedForChannelNames: async () => {},
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  } as unknown as CliContext;
}

describe("safe mode blocks Slack mutations before they hit the network", () => {
  const originalEnv = process.env.SLACKI_SAFE_MODE;
  const originalExit = process.exitCode;
  const originalError = console.error;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SLACKI_SAFE_MODE;
    } else {
      process.env.SLACKI_SAFE_MODE = originalEnv;
    }
    process.exitCode = originalExit ?? 0;
    console.error = originalError;
  });

  test.each([
    [
      ["message", "react", "add", "https://x.slack.com/archives/C1/p1", "eyes"],
      "message react add",
    ],
    [["channel", "new", "--name", "tmp"], "channel new"],
    [["channel", "invite", "--channel", "general", "--users", "U1"], "channel invite"],
    [["channel", "mark", "https://x.slack.com/archives/C1/p1"], "channel mark"],
    [["later", "save", "https://x.slack.com/archives/C1/p1"], "later save"],
    [["canvas", "create", "--markdown", "# hi"], "canvas create"],
    [["workflow", "run", "Ft1", "--channel", "general"], "workflow run"],
    [["user", "dm-open", "@alice"], "user dm-open"],
    [["message", "scheduled", "cancel", "Q1", "--channel", "C1"], "message scheduled cancel"],
  ])("%p is blocked", async (argv, command) => {
    process.env.SLACKI_SAFE_MODE = "1";
    const { registerChannelCommand } = await import("../src/cli/channel-command.ts");
    const { registerLaterCommand } = await import("../src/cli/later-command.ts");
    const { registerCanvasCommand } = await import("../src/cli/canvas-command.ts");
    const { registerWorkflowCommand } = await import("../src/cli/workflow-command.ts");
    const { registerUserCommand } = await import("../src/cli/user-command.ts");

    const program = new Command();
    const ctx = networkForbiddenCtx();
    registerMessageCommand({ program, ctx });
    registerChannelCommand({ program, ctx });
    registerLaterCommand({ program, ctx });
    registerCanvasCommand({ program, ctx });
    registerWorkflowCommand({ program, ctx });
    registerUserCommand({ program, ctx });

    const err = mock(() => {});
    console.error = err as typeof console.error;
    await program.parseAsync(argv, { from: "user" });

    expect(String(err.mock.calls[0])).toContain(`"${command}" is blocked`);
    expect(process.exitCode).toBe(1);
  });

  test("message draft create stays allowed (HITL path)", async () => {
    process.env.SLACKI_SAFE_MODE = "1";
    const { registerMessageCommand } = await import("../src/cli/message-command.ts");
    const ctx = networkForbiddenCtx();
    const program = new Command();
    registerMessageCommand({ program, ctx });
    const err = mock(() => {});
    console.error = err as typeof console.error;

    await program.parseAsync(["message", "draft", "create", "#general", "hi"], { from: "user" });

    expect(String(err.mock.calls[0] ?? "")).toContain("safe-mode gate should not touch Slack");
    expect(String(err.mock.calls[0] ?? "")).not.toContain("is blocked");
  });
});
