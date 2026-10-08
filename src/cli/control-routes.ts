import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ActionService } from "../core/service.ts";
import { ControlError, validateRequest } from "../core/action.ts";
import { planNotification } from "../core/planner.ts";
import { runLocalWorkflow } from "../core/workflow.ts";
import { loadPolicy } from "../core/runtime.ts";

export function tokenMatches(actual: unknown, expected: string): boolean {
  return (
    typeof actual === "string" &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}
export function createControlRoutes(
  service: ActionService,
  reads?: { drafts: () => Promise<unknown>; scheduled: () => Promise<unknown> },
) {
  const sessions = new Map<string, { actorId: string; workspace: string; expires: number }>();
  const actor = { id: "local-operator", source: "HUMAN_UI" as const };
  return async (input: {
    path: string;
    method: string;
    body: unknown;
    human: boolean;
    agentToken?: string;
  }) => {
    const { path, method, body, human } = input;
    if (path.startsWith("/api/agent/")) {
      const session = input.agentToken ? sessions.get(input.agentToken) : undefined;
      if (!session || session.expires <= Date.now()) {
        throw new ControlError(
          "PermissionError",
          "Agent session is missing or expired. Request a new scoped session from an operator.",
        );
      }
      const agent = { id: session.actorId, source: "AI_AGENT" as const };
      if (path === "/api/agent/actions" && method === "POST") {
        const request = validateRequest(body);
        if (request.workspace !== session.workspace) {
          throw new ControlError(
            "PermissionError",
            "Agent session is scoped to a different workspace.",
          );
        }
        return service.request(request, agent);
      }
      if (path === "/api/agent/actions" && method === "GET") {
        return (await service.list()).filter(
          (a) =>
            a.actor.source === "AI_AGENT" &&
            a.actor.id === session.actorId &&
            a.request.workspace === session.workspace,
        );
      }
      throw new ControlError(
        "PermissionError",
        "Agent sessions cannot approve actions or invoke arbitrary Slack APIs.",
      );
    }
    if (!human) {
      throw new ControlError("PermissionError", "An authenticated local UI session is required.");
    }
    if (path === "/api/control/drafts" && method === "GET" && reads) {
      return reads.drafts();
    }
    if (path === "/api/control/scheduled" && method === "GET" && reads) {
      return reads.scheduled();
    }
    if (path === "/api/control/actions" && method === "GET") {
      return service.list();
    }
    if (path === "/api/control/activity" && method === "GET") {
      return service.events();
    }
    if (path === "/api/control/policy" && method === "GET") {
      return loadPolicy();
    }
    if (path === "/api/control/actions" && method === "POST") {
      return service.request(body, actor);
    }
    if (path === "/api/control/preview" && method === "POST") {
      return service.preview(body, actor);
    }
    if (path === "/api/control/plan" && method === "POST") {
      return planNotification(body);
    }
    if (path === "/api/control/workflow" && method === "POST") {
      const request = z
        .object({ plan: z.unknown(), runKey: z.string(), dryRun: z.boolean().optional() })
        .strict()
        .parse(body);
      return runLocalWorkflow(service, { ...request, actor: { id: actor.id, source: "WORKFLOW" } });
    }
    if (path === "/api/control/agent-session" && method === "POST") {
      const request = z
        .object({
          actorId: z.string().min(1).max(100),
          workspace: z.string(),
          ttlMinutes: z.number().int().min(1).max(60).default(15),
        })
        .strict()
        .parse(body);
      const { workspace } = validateRequest({
        workspace: request.workspace,
        type: "search.execute",
        parameters: { query: "validation" },
      });
      for (const [key, session] of sessions) {
        if (session.expires <= Date.now()) {
          sessions.delete(key);
        }
      }
      if (sessions.size >= 100) {
        throw new ControlError(
          "ValidationError",
          "Too many active agent sessions. Wait for existing sessions to expire.",
        );
      }
      const token = randomBytes(32).toString("hex");
      const expires = Date.now() + request.ttlMinutes * 60000;
      sessions.set(token, { actorId: request.actorId, workspace, expires });
      return {
        token,
        actorId: request.actorId,
        workspace,
        expiresAt: new Date(expires).toISOString(),
      };
    }
    const match = /^\/api\/control\/actions\/([a-f0-9-]+)(?:\/(approve|reject|edit))?$/.exec(path);
    if (match && method === "GET" && !match[2]) {
      return service.get(match[1]!);
    }
    if (match && method === "POST" && match[2]) {
      const review = z
        .object({ revision: z.number().int().positive(), text: z.string().optional() })
        .strict()
        .parse(body);
      return service.review(match[1]!, {
        ...review,
        operation: match[2] as "approve" | "reject" | "edit",
        authority: { actor, canApprove: true },
      });
    }
    throw new ControlError("NotFoundError", "Unknown control operation.");
  };
}
