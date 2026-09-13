import { CREDENTIALS_FILE, KEYCHAIN_SERVICE } from "./paths.ts";
import { readJsonFileSafe, writeJsonFile, ensureFileMode } from "../lib/fs.ts";
import { CredentialsSchema, type Credentials, type Workspace } from "./schema.ts";
import { keychainGet, keychainSet } from "./keychain.ts";
import { platform } from "node:os";
import { access, copyFile } from "node:fs/promises";

const KEYCHAIN_PLACEHOLDER = "__KEYCHAIN__";
const IS_MACOS = platform() === "darwin";

function normalizeWorkspaceUrl(workspaceUrl: string): string {
  const u = new URL(workspaceUrl);
  return `${u.protocol}//${u.host}`;
}

function isPlaceholderSecret(value: string | undefined): boolean {
  return !value || value === KEYCHAIN_PLACEHOLDER;
}

/**
 * Keep a timestamped backup of the existing credentials file before it is
 * overwritten, so a failed write or logic bug can never silently wipe the
 * user's stored workspaces. Best-effort: hard-fails on I/O errors rather
 * than proceeding to write over possibly-good data.
 */
async function backupCredentialsIfPresent(): Promise<void> {
  try {
    await access(CREDENTIALS_FILE);
  } catch {
    return; // no existing file to back up
  }
  const backupPath = `${CREDENTIALS_FILE}.bak-${Date.now()}`;
  try {
    await copyFile(CREDENTIALS_FILE, backupPath);
  } catch (err: unknown) {
    throw new Error(
      `Failed to back up credentials file before saving (${backupPath}): ${
        err instanceof Error ? err.message : String(err)
      }. Refusing to overwrite the existing credentials.`,
    );
  }
}

export async function loadCredentials(): Promise<Credentials> {
  const fromFile = await readJsonFileSafe<unknown>(CREDENTIALS_FILE);
  if (!fromFile.ok) {
    if (fromFile.reason === "corrupt") {
      // Corrupted JSON should be surfaced, not silently treated as empty,
      // otherwise a later save would overwrite the file and lose all
      // stored workspaces. Back it up and let the caller start fresh.
      console.error(
        `Warning: credentials file is corrupted (${CREDENTIALS_FILE}). Backing it up before continuing.`,
      );
      await backupCredentialsIfPresent();
    }
    return { version: 1, workspaces: [] };
  }

  const parsed = CredentialsSchema.safeParse(fromFile.data);
  if (!parsed.success) {
    // A non-empty file that fails schema validation (e.g. a future schema
    // version) should not be silently dropped: throw so callers don't
    // overwrite it with near-empty credentials.
    throw new Error(
      `Invalid credentials file (${CREDENTIALS_FILE}): ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}. Back up or fix this file before continuing.`,
    );
  }

  // Optional: hydrate browser cookie/token from keychain for security.
  const creds = parsed.data;
  const hydrated = creds.workspaces.map((w) => {
    if (w.auth.auth_type === "browser") {
      const account = `xoxc:${normalizeWorkspaceUrl(w.workspace_url)}`;
      const xoxc = keychainGet(account, KEYCHAIN_SERVICE);
      const xoxd = keychainGet("xoxd", KEYCHAIN_SERVICE);
      return {
        ...w,
        auth: {
          auth_type: "browser" as const,
          xoxc_token: xoxc ?? w.auth.xoxc_token,
          xoxd_cookie: xoxd ?? w.auth.xoxd_cookie,
        },
      };
    }
    if (w.auth.auth_type === "standard") {
      const account = `token:${normalizeWorkspaceUrl(w.workspace_url)}`;
      const token = keychainGet(account, KEYCHAIN_SERVICE);
      return {
        ...w,
        auth: {
          auth_type: "standard" as const,
          token: token ?? w.auth.token,
        },
      };
    }
    return w;
  });

  return { ...creds, workspaces: hydrated };
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await backupCredentialsIfPresent();

  const payload: Credentials = {
    ...credentials,
    updated_at: new Date().toISOString(),
    workspaces: credentials.workspaces.map((w) => ({
      ...w,
      workspace_url: normalizeWorkspaceUrl(w.workspace_url),
    })),
  };

  // Store secrets in keychain when possible and avoid writing plaintext tokens to disk.
  // If keychain writes fail (or non-macOS), fall back to storing secrets in the file.
  const filePayload: Credentials = structuredClone(payload);

  if (IS_MACOS) {
    // Browser auth: xoxd is shared across workspaces, xoxc is per-workspace.
    const firstBrowser = payload.workspaces.find((w) => w.auth.auth_type === "browser");
    let xoxdStored = false;
    if (
      firstBrowser?.auth.auth_type === "browser" &&
      !isPlaceholderSecret(firstBrowser.auth.xoxd_cookie)
    ) {
      const existing = keychainGet("xoxd", KEYCHAIN_SERVICE);
      xoxdStored =
        existing === firstBrowser.auth.xoxd_cookie ||
        keychainSet({
          account: "xoxd",
          value: firstBrowser.auth.xoxd_cookie,
          service: KEYCHAIN_SERVICE,
        });
    }

    for (const w of filePayload.workspaces) {
      if (w.auth.auth_type === "browser") {
        const account = `xoxc:${normalizeWorkspaceUrl(w.workspace_url)}`;
        const tokenStored =
          isPlaceholderSecret(w.auth.xoxc_token) ||
          keychainGet(account, KEYCHAIN_SERVICE) === w.auth.xoxc_token ||
          keychainSet({ account, value: w.auth.xoxc_token, service: KEYCHAIN_SERVICE });

        if (tokenStored) {
          w.auth.xoxc_token = KEYCHAIN_PLACEHOLDER;
        }
        if (xoxdStored) {
          w.auth.xoxd_cookie = KEYCHAIN_PLACEHOLDER;
        }
      }

      if (w.auth.auth_type === "standard") {
        const account = `token:${normalizeWorkspaceUrl(w.workspace_url)}`;
        const tokenStored =
          isPlaceholderSecret(w.auth.token) ||
          keychainGet(account, KEYCHAIN_SERVICE) === w.auth.token ||
          keychainSet({ account, value: w.auth.token, service: KEYCHAIN_SERVICE });
        if (tokenStored) {
          w.auth.token = KEYCHAIN_PLACEHOLDER;
        }
      }
    }
  }

  await writeJsonFile(CREDENTIALS_FILE, filePayload);
  await ensureFileMode(CREDENTIALS_FILE, 0o600);
}

export async function upsertWorkspace(workspace: Workspace): Promise<Workspace> {
  const creds = await loadCredentials();
  const normalizedUrl = normalizeWorkspaceUrl(workspace.workspace_url);
  const next: Workspace = { ...workspace, workspace_url: normalizedUrl };

  const idx = creds.workspaces.findIndex(
    (w) => normalizeWorkspaceUrl(w.workspace_url) === normalizedUrl,
  );
  if (idx === -1) {
    creds.workspaces.push(next);
  } else {
    creds.workspaces[idx] = {
      ...creds.workspaces[idx],
      ...next,
      auth: next.auth,
    };
  }

  if (!creds.default_workspace_url) {
    creds.default_workspace_url = normalizedUrl;
  }
  await saveCredentials(creds);
  return next;
}

export async function upsertWorkspaces(workspaces: Workspace[]): Promise<void> {
  if (workspaces.length === 0) {
    return;
  }
  const creds = await loadCredentials();

  for (const workspace of workspaces) {
    const normalizedUrl = normalizeWorkspaceUrl(workspace.workspace_url);
    const next: Workspace = { ...workspace, workspace_url: normalizedUrl };

    const idx = creds.workspaces.findIndex(
      (w) => normalizeWorkspaceUrl(w.workspace_url) === normalizedUrl,
    );
    if (idx === -1) {
      creds.workspaces.push(next);
    } else {
      creds.workspaces[idx] = {
        ...creds.workspaces[idx],
        ...next,
        auth: next.auth,
      };
    }

    if (!creds.default_workspace_url) {
      creds.default_workspace_url = normalizedUrl;
    }
  }

  await saveCredentials(creds);
}

export async function setDefaultWorkspace(workspaceUrl: string): Promise<void> {
  const creds = await loadCredentials();
  creds.default_workspace_url = normalizeWorkspaceUrl(workspaceUrl);
  await saveCredentials(creds);
}

export async function removeWorkspace(workspaceUrl: string): Promise<void> {
  const creds = await loadCredentials();
  const normalized = normalizeWorkspaceUrl(workspaceUrl);
  creds.workspaces = creds.workspaces.filter(
    (w) => normalizeWorkspaceUrl(w.workspace_url) !== normalized,
  );
  if (creds.default_workspace_url === normalized) {
    creds.default_workspace_url = creds.workspaces[0]?.workspace_url;
  }
  await saveCredentials(creds);
}

export async function resolveWorkspaceForUrl(workspaceUrl: string): Promise<Workspace | null> {
  const creds = await loadCredentials();
  const normalized = normalizeWorkspaceUrl(workspaceUrl);
  return (
    creds.workspaces.find((w) => normalizeWorkspaceUrl(w.workspace_url) === normalized) ?? null
  );
}

export async function resolveDefaultWorkspace(): Promise<Workspace | null> {
  const creds = await loadCredentials();
  if (creds.default_workspace_url) {
    const byDefault = creds.workspaces.find((w) => w.workspace_url === creds.default_workspace_url);
    if (byDefault) {
      return byDefault;
    }
  }
  return creds.workspaces[0] ?? null;
}

// (reserved for future non-secret per-workspace metadata)
