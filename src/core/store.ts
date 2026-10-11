import { StateSchema } from "./store-validation.ts";
import type { WorkflowRun } from "./workflow-history.ts";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { ControlError, requestFingerprint, type Action, type Actor } from "./action.ts";

export type AuditEvent = {
  sequence: number;
  actionId: string;
  timestamp: string;
  actor: Actor;
  event: string;
  status: string;
  revision: number;
  reason?: string;
  requestHash: string;
  target?: Action["target"];
  decision?: Action["decision"];
  attempts: number;
  latencyMs?: number;
  transport?: Action["transport"];
};
export type State = {
  version: 1;
  actions: Action[];
  events: AuditEvent[];
  workflows?: Record<string, string>;
  workflowRuns?: WorkflowRun[];
};
export type ActionStore = { transaction<T>(work: (state: State) => T): Promise<T> };
export const emptyState = (): State => ({ version: 1, actions: [], events: [] });
export function audit(
  state: State,
  input: { action: Action; event: string; actor?: Actor; reason?: string },
): void {
  state.events.push({
    sequence: state.events.length + 1,
    actionId: input.action.id,
    timestamp: new Date().toISOString(),
    actor: input.actor ?? input.action.actor,
    event: input.event,
    status: input.action.status,
    revision: input.action.revision,
    reason: sanitize(input.reason),
    requestHash: requestFingerprint(input.action.request),
    target: structuredClone(input.action.target),
    decision: structuredClone(input.action.decision),
    attempts: input.action.attempts,
    latencyMs: input.action.latencyMs,
    transport: input.action.transport,
  });
}
export function sanitize(value: string | undefined): string | undefined {
  return value
    ?.replace(/xox[a-z]-[A-Za-z0-9%._-]+/gi, "[REDACTED]")
    .replace(/(Bearer\s+)\S+/gi, "$1[REDACTED]");
}
export function safeResult(value: Record<string, unknown>): Record<string, unknown> {
  // Keep compact receipts and explicitly shaped read results. Never persist raw API responses.
  const result = Object.fromEntries(
    [
      "ok",
      "channel",
      "ts",
      "scheduled_message_id",
      "post_at",
      "id",
      "function_execution_id",
      "trigger_execution_id",
    ]
      .filter((k) => ["string", "number", "boolean"].includes(typeof value[k]))
      .map((k) => [k, typeof value[k] === "string" ? sanitize(value[k]) : value[k]]),
  );
  for (const key of ["messages", "matches"]) {
    if (Array.isArray(value[key])) {
      result[key] = (value[key] as Record<string, unknown>[])
        .slice(0, 100)
        .map((message) =>
          Object.fromEntries(
            ["ts", "text", "user", "channel"]
              .filter((k) => typeof message[k] === "string")
              .map((k) => [k, sanitize(String(message[k]))]),
          ),
        );
    }
  }
  return result;
}

export class MemoryActionStore implements ActionStore {
  private state = emptyState();
  async transaction<T>(work: (state: State) => T): Promise<T> {
    const next = structuredClone(this.state);
    const result = work(next);
    this.state = next;
    return structuredClone(result);
  }
}
/** One atomic snapshot includes both state and append-only lifecycle events. */
export class FileActionStore implements ActionStore {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  async transaction<T>(work: (state: State) => T): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = `${this.path}.lock`;
    let locked = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        await mkdir(lock, { mode: 0o700 });
        locked = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!locked) {
      throw new ControlError(
        "StoreLockedError",
        `Action store is busy. If its owner crashed, stop all Slacki processes before removing ${lock}.`,
      );
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      let state = emptyState();
      try {
        state = StateSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new ControlError(
            "StorageError",
            "Action store is unreadable or corrupt. Restore a backup; it was not reset.",
          );
        }
      }
      const result = work(state);
      StateSchema.parse(state);
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(state));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
      const directory = await open(dirname(this.path), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return structuredClone(result);
    } finally {
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true });
    }
  }
}
