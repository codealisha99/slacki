import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const ActorSchema = z
  .object({
    id: z.string().min(1).max(100),
    source: z.enum(["HUMAN_CLI", "HUMAN_UI", "AI_AGENT", "WORKFLOW", "SYSTEM"]),
  })
  .strict();
export type Actor = z.infer<typeof ActorSchema>;
const channel = z.string().min(1).max(100);
const text = z.string().max(40000);
const blocks = z.array(z.record(z.string(), z.unknown())).optional();
const outbound = { blocks, reply_broadcast: z.boolean().optional() };
const ts = z.string().regex(/^\d+\.\d+$/);
const envelope = { workspace: z.string().url(), key: z.string().min(1).max(200).optional() };
export const RequestSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...envelope,
      type: z.literal("workflow.run"),
      target: channel,
      parameters: z
        .object({
          trigger_id: z.string().regex(/^Ft[A-Za-z0-9]+$/),
          shortcut_url: z
            .string()
            .url()
            .refine((value) => {
              const url = new URL(value);
              return (
                url.protocol === "https:" &&
                (url.hostname === "slack.com" || url.hostname.endsWith(".slack.com")) &&
                url.pathname.startsWith("/shortcuts/") &&
                !url.username &&
                !url.password
              );
            }, "Expected a Slack workflow shortcut URL"),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("message.send"),
      target: channel,
      parameters: z.object({ text, thread_ts: ts.optional(), ...outbound }).strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("message.edit"),
      target: channel,
      parameters: z.object({ text, ts, blocks }).strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("message.delete"),
      target: channel,
      parameters: z.object({ ts }).strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("message.react"),
      target: channel,
      parameters: z.object({ ts, name: z.string().regex(/^[\w+-]+$/) }).strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("message.schedule"),
      target: channel,
      parameters: z
        .object({
          text,
          post_at: z.number().int().positive(),
          ...outbound,
          thread_ts: ts.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("draft.create"),
      target: channel,
      parameters: z.object({ text, thread_ts: ts.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("search.execute"),
      parameters: z.object({ query: z.string().min(1).max(1000) }).strict(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal("message.read"),
      target: channel,
      parameters: z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict(),
    })
    .strict(),
]);
export type ActionRequest = z.infer<typeof RequestSchema>;
export type Decision = {
  effect: "ALLOW" | "DENY" | "REQUIRE_APPROVAL";
  reason: string;
  rules: string[];
};
export type Status =
  | "REQUESTED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "DENIED"
  | "EXECUTING"
  | "SUCCESS"
  | "FAILED"
  | "UNCERTAIN";
export type Action = {
  id: string;
  request: ActionRequest;
  actor: Actor;
  revision: number;
  requestHash: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
  target?: { id: string; name?: string; user?: string };
  decision?: Decision;
  approval?: { expiresAt: string; by?: Actor; revision?: number };
  result?: Record<string, unknown>;
  error?: string;
  latencyMs?: number;
  attempts: number;
  transport?: { rateLimits: number; retries: number };
};
export class ControlError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}
export function validateRequest(value: unknown): ActionRequest {
  const parsed = RequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ControlError(
      "ValidationError",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  if (/xox[a-z]-[A-Za-z0-9%._-]+/i.test(JSON.stringify(parsed.data))) {
    throw new ControlError(
      "ValidationError",
      "Slack credentials cannot be stored in action content or parameters.",
    );
  }
  if (
    "text" in parsed.data.parameters &&
    !parsed.data.parameters.text &&
    !("blocks" in parsed.data.parameters && parsed.data.parameters.blocks?.length)
  ) {
    throw new ControlError("ValidationError", "Provide non-empty text or message blocks.");
  }
  const url = new URL(parsed.data.workspace);
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new ControlError(
      "ValidationError",
      "workspace must be an explicit https://<workspace>.slack.com origin",
    );
  }
  return { ...parsed.data, workspace: url.origin };
}
export function createAction(value: unknown, actor: Actor): Action {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    request: validateRequest(value),
    actor: ActorSchema.parse(actor),
    revision: 1,
    requestHash: requestFingerprint(validateRequest(value)),
    status: "REQUESTED",
    createdAt: now,
    updatedAt: now,
    attempts: 0,
  };
}
const transitions: Record<Status, Status[]> = {
  REQUESTED: ["PENDING_APPROVAL", "DENIED", "EXECUTING", "FAILED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "EXPIRED", "DENIED"],
  APPROVED: ["EXECUTING", "DENIED", "EXPIRED", "FAILED"],
  EXECUTING: ["SUCCESS", "FAILED", "UNCERTAIN"],
  SUCCESS: [],
  FAILED: [],
  UNCERTAIN: [],
  REJECTED: [],
  EXPIRED: [],
  DENIED: [],
};
export function transition(action: Action, status: Status): void {
  if (!transitions[action.status].includes(status)) {
    throw new ControlError("ConflictError", `Cannot transition ${action.status} to ${status}`);
  }
  action.status = status;
  action.updatedAt = new Date().toISOString();
}

export function requestFingerprint(request: ActionRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}
