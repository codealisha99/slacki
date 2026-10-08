import { expect, test } from "bun:test";
import { createAction } from "../src/core/action.ts";
import { defaultPolicy, evaluatePolicy } from "../src/core/policy.ts";
const make = (source: "AI_AGENT" | "HUMAN_CLI", type = "message.send") =>
  createAction(
    {
      type,
      workspace: "https://example.slack.com",
      target: "C01234567",
      parameters: type === "message.delete" ? { ts: "1234.0001" } : { text: "hello" },
    },
    { id: "test", source },
  );
test("policy defaults explain allow, approval and denial", () => {
  const options = { policy: defaultPolicy(), safeMode: false };
  expect(evaluatePolicy(make("HUMAN_CLI"), options).effect).toBe("ALLOW");
  expect(evaluatePolicy(make("AI_AGENT"), options).effect).toBe("REQUIRE_APPROVAL");
  expect(evaluatePolicy(make("AI_AGENT", "message.delete"), options).effect).toBe("DENY");
  expect(evaluatePolicy(make("HUMAN_CLI", "message.delete"), options).effect).toBe(
    "REQUIRE_APPROVAL",
  );
});
test("safe mode and deny take precedence regardless of rule order", () => {
  const policy = defaultPolicy();
  policy.rules = [
    { id: "allow", effect: "ALLOW", reason: "explicit grant" },
    { id: "deny", effect: "DENY", reason: "blocked" },
  ];
  expect(evaluatePolicy(make("AI_AGENT"), { policy, safeMode: false }).rules).toEqual(["deny"]);
  policy.rules.pop();
  expect(evaluatePolicy(make("AI_AGENT"), { policy, safeMode: true }).rules).toEqual(["safe-mode"]);
  expect(
    evaluatePolicy(make("AI_AGENT", "message.delete"), { policy, safeMode: false }).effect,
  ).toBe("ALLOW");
});
test("approval dominates allow and target matching uses resolved identity", () => {
  const a = make("HUMAN_CLI");
  a.target = { id: "C01234567", name: "general" };
  const policy = defaultPolicy();
  expect(evaluatePolicy(a, { policy, safeMode: false }).effect).toBe("REQUIRE_APPROVAL");
  policy.rules = [
    { id: "allow", effect: "ALLOW", reason: "allow" },
    { id: "review", effect: "REQUIRE_APPROVAL", reason: "sensitive", targets: ["C01234567"] },
  ];
  expect(evaluatePolicy(a, { policy, safeMode: false }).rules).toEqual(["review"]);
});
