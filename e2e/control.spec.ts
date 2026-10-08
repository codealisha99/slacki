import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("mock Slack: unlock, scoped agent, review/edit/approve, audit, draft and mobile", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Unlock Slacki" })).toBeVisible();
  expect((await request.get("/api/control/actions")).status()).toBe(401);
  const metadata = JSON.parse(await readFile(process.env.SLACKI_E2E_SESSION_META!, "utf8"));
  const code = await readFile(metadata.sessionFile, "utf8");
  expect(await page.content()).not.toContain(code);
  await page.getByLabel("Operator code").fill(code);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  const requested = await page.evaluate(async () => {
    const session = await fetch("/api/control/agent-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: "deployment-agent", workspace: "https://fixture.slack.com" }),
    }).then((r) => r.json());
    const headers = { "Content-Type": "application/json", "x-slacki-agent-token": session.token };
    const action = await fetch("/api/agent/actions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "message.send",
        workspace: "https://fixture.slack.com",
        target: "#engineering",
        parameters: { text: "Production deployment failed." },
        key: "playwright-deployment",
      }),
    }).then((r) => r.json());
    return { id: action.id, status: action.status };
  });
  expect(requested.status).toBe("PENDING_APPROVAL");
  await page.getByRole("button", { name: "Approvals", exact: true }).click();
  await page.getByRole("button", { name: "message.send · #engineering", exact: true }).click();
  await expect(
    page.getByText("Requested by AI_AGENT: deployment-agent", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Message content")
    .fill("Production deployment failed. Rollback is in progress.");
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Edit saved" })).toBeVisible();
  await page.getByRole("button", { name: "Approve and execute", exact: true }).click();
  await expect(page.locator("#control .badge")).toHaveText("SUCCESS");
  await expect(page.locator("#control")).toContainText("execution-finished");
  await expect(page.locator("#control")).toContainText("Rollback is in progress");
  await page.screenshot({ path: ".cache/control-approval-success.png", fullPage: true });
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await page
    .locator("#control")
    .getByLabel("Message", { exact: true })
    .fill("Draft for review only");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.locator("#control .badge")).toHaveText("SUCCESS");
  await page.getByRole("button", { name: "Scheduled", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delivery queue in Slack" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
