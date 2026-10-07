import { afterEach, describe, expect, test } from "bun:test";
import type { CliContext } from "../src/cli/context.ts";
import { collectDoctorReport, doctorNextSteps } from "../src/cli/doctor-command.ts";
import { probeSlackDesktopPaths } from "../src/auth/desktop.ts";

describe("doctorNextSteps", () => {
  test("points at desktop import when Slack Desktop data is present", () => {
    expect(
      doctorNextSteps({
        workspaceCount: 0,
        credentialsExist: false,
        desktopLeveldb: true,
        authOk: undefined,
      }),
    ).toEqual(["slacki auth import-desktop"]);
  });

  test("points at env/browser import when desktop data is missing", () => {
    const [step] = doctorNextSteps({
      workspaceCount: 0,
      credentialsExist: false,
      desktopLeveldb: false,
      authOk: undefined,
    });
    expect(step).toContain("SLACK_TOKEN");
  });

  test("suggests unreads after a successful auth.test", () => {
    expect(
      doctorNextSteps({
        workspaceCount: 1,
        credentialsExist: true,
        desktopLeveldb: true,
        authOk: true,
      }),
    ).toEqual(["slacki unreads --counts-only"]);
  });
});

describe("probeSlackDesktopPaths", () => {
  test("reports whether this platform is supported and lists candidate dirs", () => {
    const probe = probeSlackDesktopPaths();
    expect(typeof probe.supported).toBe("boolean");
    expect(probe.platform).toBe(process.platform);
    if (probe.supported) {
      expect(probe.candidates.length).toBeGreaterThan(0);
      expect(probe.candidates.every((c) => typeof c.base_dir === "string")).toBe(true);
    }
  });
});

describe("collectDoctorReport", () => {
  const originalToken = process.env.SLACK_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.SLACK_TOKEN;
    } else {
      process.env.SLACK_TOKEN = originalToken;
    }
  });

  test("does not print secrets and skips auth.test when nothing is configured", async () => {
    delete process.env.SLACK_TOKEN;
    const ctx = {
      effectiveWorkspaceUrl: () => undefined,
      errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
      withAutoRefresh: async () => {
        throw new Error("should not call Slack");
      },
      getClientForWorkspace: async () => {
        throw new Error("should not call Slack");
      },
    } as unknown as CliContext;

    const report = await collectDoctorReport({
      ctx,
      deps: {
        credentialsExist: false,
        loadCredentials: async () => ({ version: 1, workspaces: [] }),
        probeDesktop: () => ({
          platform: "darwin",
          supported: true,
          candidates: [
            {
              kind: "macos-electron",
              base_dir: "/tmp/Slack",
              leveldb_present: true,
              cookies_present: true,
            },
          ],
        }),
      },
    });

    expect(report.safe_mode).toBe(false);
    expect(report.credentials).toMatchObject({
      exists: false,
      workspace_count: 0,
    });
    expect(report.auth_test).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("xoxc");
    expect(JSON.stringify(report)).not.toContain("xoxd");
    expect(report.next).toEqual(["slacki auth import-desktop"]);
  });

  test("records auth.test failure without throwing", async () => {
    delete process.env.SLACK_TOKEN;
    const ctx = {
      effectiveWorkspaceUrl: () => undefined,
      errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
      withAutoRefresh: async () => {
        throw new Error("invalid_auth");
      },
      getClientForWorkspace: async () => {
        throw new Error("invalid_auth");
      },
    } as unknown as CliContext;

    const report = await collectDoctorReport({
      ctx,
      deps: {
        credentialsExist: true,
        loadCredentials: async () => ({
          version: 1,
          workspaces: [
            {
              workspace_url: "https://example.slack.com",
              workspace_name: "Example",
              auth: { auth_type: "standard", token: "xoxb-secret" },
            },
          ],
        }),
        probeDesktop: () => ({
          platform: "darwin",
          supported: true,
          candidates: [],
        }),
      },
    });

    expect(report.auth_test).toEqual({ ok: false, error: "invalid_auth" });
    expect(JSON.stringify(report)).not.toContain("xoxb-secret");
    expect(report.next).toContain("slacki auth test");
  });
});
