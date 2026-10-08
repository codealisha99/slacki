import type { Action } from "./action.ts";

/** Implementations must dispatch exclusively through SlackApiClient. */
export type ExecutionPort = {
  resolve(action: Action): Promise<void>;
  execute(action: Action): Promise<Record<string, unknown>>;
};
