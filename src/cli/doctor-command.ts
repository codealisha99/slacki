import { existsSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import type { Command } from "commander";
import type { CliContext } from "./context.ts";
import { CREDENTIALS_FILE } from "../auth/paths.ts";
import { loadCredentials } from "../auth/store.ts";
import { probeSlackDesktopPaths, type SlackDesktopPathProbe } from "../auth/desktop.ts";
import { pruneEmpty } from "../lib/compact-json.ts";
import { getPackageVersion } from "../lib/version.ts";
import { getString, isRecord } from "../lib/object-type-guards.ts";
import { isSafeModeEnabled } from "./safe-mode.ts";
import type { Credentials } from "../auth/schema.ts";

function runtimeName(): string {
  const bunVersion = typeof Bun !== "undefined" ? (Bun.version as string | undefined) : undefined;
  if (bunVersion) {
    return `bun ${bunVersion}`;
  }
  return `node ${process.version}`;
}

async function probeAuthTest(
  ctx: CliContext,
  workspaceUrl: string | undefined,
): Promise<Record<string, unknown>> {
  try {
    const resp = await ctx.withAutoRefresh({
      workspaceUrl,
      work: async () => {
        const { client, auth, workspace_url } = await ctx.getClientForWorkspace(workspaceUrl);
        const raw = await client.api("auth.test", {});
        const data = isRecord(raw) ? raw : {};
        return {
          ok: data.ok !== false,
          auth_type: auth.auth_type,
          workspace_url: workspace_url,
          user: getString(data.user),
          user_id: getString(data.user_id),
          team: getString(data.team),
          team_id: getString(data.team_id),
          url: getString(data.url),
        };
      },
    });
    return resp as Record<string, unknown>;
  } catch (err: unknown) {
    return { ok: false, error: ctx.errorMessage(err) };
  }
}

export function doctorNextSteps(input: {
  workspaceCount: number;
  credentialsExist: boolean;
  desktopLeveldb: boolean;
  authOk: boolean | undefined;
}): string[] {
  const steps: string[] = [];
  if (!input.credentialsExist || input.workspaceCount === 0) {
    if (input.desktopLeveldb) {
      steps.push("slacki auth import-desktop");
    } else {
      steps.push(
        "Set SLACK_TOKEN (and SLACK_COOKIE_D for browser tokens), or run auth import-chrome / import-brave / import-firefox / parse-curl",
      );
    }
  }
  if (input.workspaceCount > 0 && input.authOk !== true) {
    steps.push("slacki auth test");
  }
  if (input.authOk === true) {
    steps.push("slacki unreads --counts-only");
  }
  return steps;
}

export type DoctorDeps = {
  loadCredentials?: () => Promise<Credentials>;
  probeDesktop?: () => SlackDesktopPathProbe;
  credentialsExist?: boolean;
};

export async function collectDoctorReport(input: {
  ctx: CliContext;
  cliSafeMode?: boolean;
  deps?: DoctorDeps;
}): Promise<Record<string, unknown>> {
  const probeDesktop = input.deps?.probeDesktop ?? probeSlackDesktopPaths;
  const loadCreds = input.deps?.loadCredentials ?? loadCredentials;
  const credentialsExist = input.deps?.credentialsExist ?? existsSync(CREDENTIALS_FILE);
  const desktop = probeDesktop();
  let workspaceCount = 0;
  let defaultWorkspaceUrl: string | undefined;
  let workspaces: Record<string, unknown>[] = [];
  let credentialsError: string | undefined;

  try {
    const creds = await loadCreds();
    workspaceCount = creds.workspaces.length;
    defaultWorkspaceUrl = creds.default_workspace_url;
    workspaces = creds.workspaces.map((w) => ({
      workspace_url: w.workspace_url,
      workspace_name: w.workspace_name,
      auth_type: w.auth.auth_type,
    }));
  } catch (err: unknown) {
    credentialsError = input.ctx.errorMessage(err);
  }

  const envToken = Boolean(process.env.SLACK_TOKEN?.trim());
  const shouldProbeAuth = envToken || workspaceCount > 0;
  const authTest = shouldProbeAuth
    ? await probeAuthTest(input.ctx, input.ctx.effectiveWorkspaceUrl())
    : undefined;
  const authOk = isRecord(authTest) ? authTest.ok === true : undefined;
  const desktopLeveldb = desktop.candidates.some((c) => c.leveldb_present);

  return {
    version: getPackageVersion(),
    runtime: runtimeName(),
    platform: platform(),
    arch: arch(),
    home: homedir(),
    safe_mode: isSafeModeEnabled({ cliFlag: input.cliSafeMode }),
    env: {
      SLACK_TOKEN: envToken,
      SLACK_COOKIE_D: Boolean(process.env.SLACK_COOKIE_D?.trim()),
      SLACK_WORKSPACE_URL: process.env.SLACK_WORKSPACE_URL?.trim() || undefined,
      SLACKI_SAFE_MODE: process.env.SLACKI_SAFE_MODE?.trim() || undefined,
    },
    credentials: {
      path: CREDENTIALS_FILE,
      exists: credentialsExist,
      error: credentialsError,
      default_workspace_url: defaultWorkspaceUrl,
      workspace_count: workspaceCount,
      workspaces,
    },
    slack_desktop: desktop,
    auth_test: authTest,
    next: doctorNextSteps({
      workspaceCount,
      credentialsExist,
      desktopLeveldb,
      authOk,
    }),
  };
}

export function registerDoctorCommand(input: { program: Command; ctx: CliContext }): void {
  input.program
    .command("doctor")
    .description("Diagnose local auth, Slack Desktop paths, and connectivity (no secrets)")
    .action(async () => {
      try {
        const payload = await collectDoctorReport({
          ctx: input.ctx,
          cliSafeMode: Boolean(input.program.opts().safeMode),
        });
        console.log(JSON.stringify(pruneEmpty(payload), null, 2));
      } catch (err: unknown) {
        console.error(input.ctx.errorMessage(err));
        process.exitCode = 1;
      }
    });
}
