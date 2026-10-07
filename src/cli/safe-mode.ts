import type { Command } from "commander";
import type { CliContext } from "./context.ts";
import { composeMessage } from "./compose-actions.ts";

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Mutations that post, edit Slack state, or otherwise have side effects.
 * `message send` is redirected to the draft editor instead of being blocked.
 * Slack-native drafts stay allowed — they post nothing until a human sends.
 */
export const SAFE_MODE_BLOCKED_COMMANDS = [
  "message compose",
  "message edit",
  "message delete",
  "message react add",
  "message react remove",
  "message scheduled cancel",
  "channel new",
  "channel invite",
  "channel mark",
  "later complete",
  "later archive",
  "later reopen",
  "later save",
  "later remove",
  "later remind",
  "canvas create",
  "workflow run",
  "user dm-open",
] as const;

export type SafeModeBlockedCommand = (typeof SAFE_MODE_BLOCKED_COMMANDS)[number];

/**
 * Safe mode keeps a human in the loop for Slack side effects:
 * `message send` is redirected to the draft editor; other mutations in
 * `SAFE_MODE_BLOCKED_COMMANDS` are blocked. Enabled via the global
 * `--safe-mode` flag or SLACKI_SAFE_MODE ("1", "true", "yes", "on").
 */
export function isSafeModeEnabled(input?: {
  cliFlag?: boolean;
  env?: Record<string, string | undefined>;
}): boolean {
  if (input?.cliFlag) {
    return true;
  }
  const env = input?.env ?? process.env;
  const raw = env.SLACKI_SAFE_MODE?.trim().toLowerCase();
  return raw !== undefined && TRUTHY_VALUES.has(raw);
}

export function isSafeModeEnabledFor(command: Command): boolean {
  let current: Command | null = command;
  while (current) {
    if ((current.opts() as { safeMode?: boolean }).safeMode) {
      return true;
    }
    current = current.parent;
  }
  return isSafeModeEnabled();
}

export function safeModeBlockedError(command: string): Error {
  return new Error(
    `Safe mode is active (SLACKI_SAFE_MODE or --safe-mode): "${command}" is blocked so an agent cannot mutate Slack without human review. Use "message draft create" for review-only writes, or disable safe mode.`,
  );
}

export function assertSafeModeAllows(command: Command, action: string): void {
  if (!isSafeModeEnabledFor(command)) {
    return;
  }
  throw safeModeBlockedError(action);
}

export type SendOptionsForRedirect = {
  workspace?: string;
  threadTs?: string;
  attach?: string[];
  blocks?: string;
  replyBroadcast?: boolean;
  schedule?: string;
  scheduleIn?: string;
};

/**
 * Redirects `message send` to the interactive draft editor so a human
 * reviews and sends the message. Flags the draft editor cannot represent
 * (attachments, raw blocks, scheduling, broadcasts) are rejected instead
 * of being silently dropped.
 */
export async function redirectSendToDraft(
  input: {
    ctx: CliContext;
    targetInput: string;
    text: string;
    options: SendOptionsForRedirect;
  },
  draftFn: typeof composeMessage = composeMessage,
): Promise<Record<string, unknown>> {
  const unsupported: string[] = [];
  if ((input.options.attach ?? []).length > 0) {
    unsupported.push("--attach");
  }
  if (input.options.blocks !== undefined) {
    unsupported.push("--blocks");
  }
  if (input.options.schedule !== undefined) {
    unsupported.push("--schedule");
  }
  if (input.options.scheduleIn !== undefined) {
    unsupported.push("--schedule-in");
  }
  if (input.options.replyBroadcast) {
    unsupported.push("--reply-broadcast");
  }
  if (unsupported.length > 0) {
    throw new Error(
      `Safe mode is active: "message send" is redirected to the draft editor, which does not support ${unsupported.join(", ")}. Drop those flags or disable safe mode.`,
    );
  }
  if (process.env.CI) {
    throw new Error(
      "Safe mode is active but the interactive draft editor is unavailable in CI. Disable safe mode (or unset CI) to send messages.",
    );
  }

  console.error(
    '⚠ Safe mode active: redirecting "message send" → draft editor. Nothing posts until a human sends it from the editor.',
  );

  const payload = await draftFn({
    ctx: input.ctx,
    targetInput: input.targetInput,
    initialText: input.text,
    options: { workspace: input.options.workspace, threadTs: input.options.threadTs },
  });
  return { safe_mode: true, redirected_from: "send", ...payload };
}
