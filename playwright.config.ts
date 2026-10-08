import { defineConfig } from "@playwright/test";
import { join } from "node:path";
const port = process.env.SLACKI_E2E_PORT || "18790";
const baseURL = `http://127.0.0.1:${port}`;
const metadata = join(process.cwd(), ".cache", "e2e-session.json");
process.env.SLACKI_E2E_SESSION_META = metadata;
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL, headless: true, trace: "retain-on-failure" },
  webServer: {
    command: "bun scripts/mock-control.ts",
    url: baseURL,
    reuseExistingServer: false,
    env: { SLACKI_TEST_PORT: port, SLACKI_TEST_SESSION_FILE: metadata },
  },
});
