import { expect, test } from "bun:test";
import { createAction, transition, validateRequest } from "../src/core/action.ts";
const request = {
  type: "message.send",
  workspace: "https://example.slack.com",
  target: "#engineering",
  parameters: { text: "Deployment failed" },
};
test("actions validate and serialize without losing requester", () => {
  const a = createAction(request, { id: "deployment", source: "AI_AGENT" });
  expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  expect(a.status).toBe("REQUESTED");
  transition(a, "PENDING_APPROVAL");
  transition(a, "APPROVED");
  transition(a, "EXECUTING");
  transition(a, "SUCCESS");
  expect(() => transition(a, "EXECUTING")).toThrow("Cannot transition");
});
test("reject malformed requests and caller-supplied execution state", () => {
  for (const value of [
    null,
    {},
    { ...request, status: "APPROVED" },
    { ...request, parameters: {} },
    { ...request, workspace: "https://attacker.test" },
  ]) {
    expect(() => validateRequest(value)).toThrow();
  }
});
