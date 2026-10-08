import { z } from "zod";

const InputSchema = z
  .object({
    intent: z.string().min(1).max(4000),
    workspace: z.string().url(),
    channel: z.string().min(1).optional(),
    message: z.string().min(1).max(40000).optional(),
    followUpAt: z.number().int().positive().optional(),
  })
  .strict();
/** Deliberately bounded planner. Natural language never grants execution authority. */
export function planNotification(value: unknown) {
  const input = InputSchema.parse(value);
  const missing: string[] = [];
  if (!input.channel) {
    missing.push("Specify the exact destination channel; team names are not channel mappings.");
  }
  if (!input.message) {
    missing.push("Provide the notification text for human review.");
  }
  if (/tomorrow|follow.up|schedule/i.test(input.intent) && !input.followUpAt) {
    missing.push("Specify followUpAt as a Unix timestamp with an explicit timezone conversion.");
  }
  if (!/notify|notification|send|alert/i.test(input.intent)) {
    missing.push(
      "This planner supports notifications only. Use a structured workflow for other tasks.",
    );
  }
  return {
    intent: input.intent,
    status: missing.length ? "NEEDS_INPUT" : "READY_FOR_REVIEW",
    missing,
    plan: missing.length
      ? undefined
      : {
          id: "notification",
          context: {},
          steps: [
            {
              id: "notify",
              action: {
                type: "message.send",
                workspace: input.workspace,
                target: input.channel,
                parameters: { text: input.message },
              },
            },
            ...(input.followUpAt
              ? [
                  {
                    id: "follow-up",
                    action: {
                      type: "message.schedule",
                      workspace: input.workspace,
                      target: input.channel,
                      parameters: {
                        text: `Follow-up: ${input.message}`,
                        post_at: input.followUpAt,
                      },
                    },
                  },
                ]
              : []),
          ],
        },
    executes: false,
  };
}
