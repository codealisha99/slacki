import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("mock Slack: unlock, scoped agent, review/edit/approve, audit, draft and mobile", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Unlock Slacki" })).toBeVisible();
  expect((await request.get("/api/control/actions")).status()).toBe(401);
  expect((await request.get("/api/control/workflows")).status()).toBe(401);
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
        parameters: {
          text: "Production deployment failed.",
          blocks: [
            { type: "section", text: { type: "plain_text", text: "Original block content" } },
          ],
        },
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
  await expect(page.locator("#control")).toContainText("Original block content");
  await page
    .getByLabel("Message content")
    .fill("Production deployment failed. Rollback is in progress.");
  await page.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Edit saved" })).toBeVisible();
  await page.getByRole("button", { name: "Approve and execute", exact: true }).click();
  await expect(page.locator("#control .detail .badge")).toHaveText("SUCCESS");
  await expect(page.locator("#control")).toContainText("execution-finished");
  await expect(page.locator("#control")).toContainText("Rollback is in progress");
  await expect(page.locator("#control")).not.toContainText("Original block content");
  await page.screenshot({ path: ".cache/control-approval-success.png", fullPage: true });
  await page.getByRole("button", { name: "Drafts", exact: true }).click();
  await page
    .locator("#control")
    .getByLabel("Message", { exact: true })
    .fill("Draft for review only");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.locator("#control .detail .badge")).toHaveText("SUCCESS");
  await page.getByRole("button", { name: "Scheduled", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delivery queue in Slack" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

test("retrying a lost UI response reuses the original action", async ({ page }) => {
  await page.goto("/");
  const metadata = JSON.parse(await readFile(process.env.SLACKI_E2E_SESSION_META!, "utf8"));
  await page.getByLabel("Operator code").fill(await readFile(metadata.sessionFile, "utf8"));
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  await page
    .locator("#control")
    .getByLabel("Message", { exact: true })
    .fill("Lost response recovery fixture");
  let lost = false;
  await page.route("**/api/control/actions", async (route) => {
    if (route.request().method() === "POST" && !lost) {
      lost = true;
      await route.fetch(); // Slacki accepted the request; only the browser response is lost.
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Request action", exact: true }).click();
  await expect(page.locator("#control-notice")).toContainText(/fetch/i);
  await page.getByRole("button", { name: "Request action", exact: true }).click();
  await expect(page.locator("#control .detail .badge")).toHaveText("SUCCESS");
  const receipts = await page.evaluate(async () => {
    const actions = await fetch("/api/control/actions").then((r) => r.json());
    return actions.filter(
      (a: { request: { parameters: { text?: string } } }) =>
        a.request.parameters.text === "Lost response recovery fixture",
    );
  });
  expect(receipts).toHaveLength(1);
  expect(receipts[0].attempts).toBe(1);
});

test("workflow run history persists across reload and links to pending approval", async ({
  page,
}) => {
  await page.goto("/");
  const metadata = JSON.parse(await readFile(process.env.SLACKI_E2E_SESSION_META!, "utf8"));
  await page.getByLabel("Operator code").fill(await readFile(metadata.sessionFile, "utf8"));
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByLabel("Run key", { exact: true }).fill("browser-workflow-history");
  await page.getByRole("button", { name: "Preview workflow", exact: true }).click();
  await expect(page.locator("#control")).toContainText("DRY_RUN");
  await page.getByRole("button", { name: "Run or resume", exact: true }).click();
  await expect(page.locator("#control section")).toContainText("PAUSED");
  await page.reload();
  await page.getByRole("button", { name: "Workflows", exact: true }).click();
  await expect(page.locator("#control section")).toContainText("browser-workflow-history");
  await page.getByRole("button", { name: "Inspect run", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect message.send: PENDING_APPROVAL", exact: true })
    .click();
  await expect(page.locator("#control .detail .badge")).toHaveText("PENDING_APPROVAL");
});
