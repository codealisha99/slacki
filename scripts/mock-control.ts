import { controlFixture } from "../test/support/control-fixture.ts";
import { startInboxUi } from "../src/cli/ui-server.ts";
import { dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
const fixture = controlFixture();
const running = await startInboxUi({
  ctx: fixture.ctx,
  workspaceUrl: fixture.workspace,
  actionService: fixture.service,
  port: Number(process.env.SLACKI_TEST_PORT || 8788),
  openBrowser: false,
});
console.error("MOCK SLACK ONLY: all Slack HTTP requests are intercepted by the fixture.");
if (process.env.SLACKI_TEST_SESSION_FILE) {
  await mkdir(dirname(process.env.SLACKI_TEST_SESSION_FILE), { recursive: true, mode: 0o700 });
  await writeFile(
    process.env.SLACKI_TEST_SESSION_FILE,
    JSON.stringify({ url: running.url, sessionFile: running.sessionFile }),
    { mode: 0o600 },
  );
}
const stop = async () => {
  await running.close();
  fixture.restore();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
