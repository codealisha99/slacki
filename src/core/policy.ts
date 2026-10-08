import { z } from "zod";
import type { Action, Decision } from "./action.ts";

export const PolicySchema = z
  .object({
    version: z.literal(1),
    approvalTtlMs: z.number().int().min(1000).max(86400000).default(3600000),
    rules: z
      .array(
        z
          .object({
            id: z.string().min(1),
            effect: z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]),
            reason: z.string().min(1),
            sources: z
              .array(z.enum(["HUMAN_CLI", "HUMAN_UI", "AI_AGENT", "WORKFLOW", "SYSTEM"]))
              .optional(),
            types: z.array(z.string()).optional(),
            workspaces: z.array(z.string()).optional(),
            targets: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type Policy = z.infer<typeof PolicySchema>;
export const defaultPolicy = (): Policy => PolicySchema.parse({ version: 1 });
export const isRead = (action: Action): boolean =>
  ["search.execute", "message.read"].includes(action.request.type);
export const isDestructive = (action: Action): boolean =>
  ["message.delete", "message.edit", "workflow.run"].includes(action.request.type);

export function evaluatePolicy(
  action: Action,
  options: { policy: Policy; safeMode: boolean },
): Decision {
  const { policy, safeMode } = options;
  const decision = (effect: Decision["effect"], reason: string, rules: string[]): Decision => ({
    effect,
    reason,
    rules,
  });
  if (safeMode && !isRead(action) && action.request.type !== "draft.create") {
    return decision(
      "DENY",
      "Safe mode blocks this Slack mutation. Disable safe mode only after human review.",
      ["safe-mode"],
    );
  }
  const matching = policy.rules.filter(
    (rule) =>
      (!rule.sources || rule.sources.includes(action.actor.source)) &&
      (!rule.types || rule.types.includes(action.request.type)) &&
      (!rule.workspaces || rule.workspaces.includes(action.request.workspace)) &&
      (!rule.targets ||
        rule.targets.some((t) =>
          [
            action.target?.id,
            action.target?.name && `#${action.target.name}`,
            action.target?.user,
          ].includes(t),
        )),
  );
  // Deny wins globally, then approval, then explicit allow. Order in the file is irrelevant.
  for (const effect of ["DENY", "REQUIRE_APPROVAL", "ALLOW"] as const) {
    const matches = matching.filter((r) => r.effect === effect);
    if (matches.length) {
      return decision(
        effect,
        matches.map((r) => r.reason).join("; "),
        matches.map((r) => r.id),
      );
    }
  }
  if (isRead(action) || action.request.type === "draft.create") {
    return decision("ALLOW", "Read operations and review-only drafts are allowed.", [
      "default-read-draft",
    ]);
  }
  if (action.actor.source === "AI_AGENT" && isDestructive(action)) {
    return decision(
      "DENY",
      "AI agents need an explicit policy grant for destructive message operations or opaque native workflow triggers.",
      ["default-agent-destructive"],
    );
  }
  if (
    action.request.type === "message.delete" ||
    action.request.type === "workflow.run" ||
    action.target?.name === "general"
  ) {
    return decision(
      "REQUIRE_APPROVAL",
      "Message deletion, Slack-native workflow triggers and writes to #general require human approval.",
      ["default-sensitive"],
    );
  }
  if (["AI_AGENT", "WORKFLOW", "SYSTEM"].includes(action.actor.source)) {
    return decision("REQUIRE_APPROVAL", "Automated Slack mutations require human review.", [
      "default-automation",
    ]);
  }
  return decision("ALLOW", "Human-requested action is allowed by default policy.", [
    "default-human",
  ]);
}
