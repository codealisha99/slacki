import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { isRecord } from "./object-type-guards.ts";

export type ReadJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "missing" | "corrupt" };

export async function readJsonFileSafe<T>(path: string): Promise<ReadJsonResult<T>> {
  try {
    const raw = await readFile(path, "utf8");
    return { ok: true, data: JSON.parse(raw) as T };
  } catch (err: unknown) {
    if (isRecord(err) && err.code === "ENOENT") {
      return { ok: false, reason: "missing" };
    }
    // Corrupted JSON is distinguishable from a missing file; callers decide
    // whether to treat it as empty or surface an error.
    if (err instanceof SyntaxError) {
      return { ok: false, reason: "corrupt" };
    }
    throw err;
  }
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  const result = await readJsonFileSafe<T>(path);
  return result.ok ? result.data : null;
}

export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Tighten permissions on an existing file to the given mode. Best-effort:
 * failures are swallowed so callers can still proceed when they cannot widen
 * access (e.g. on filesystems that ignore POSIX modes).
 */
export async function ensureFileMode(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode);
  } catch {
    // ignore
  }
}
