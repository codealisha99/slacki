import { AsyncLocalStorage } from "node:async_hooks";
export type SlackTelemetry = { rateLimits: number; retries: number };
const scope = new AsyncLocalStorage<SlackTelemetry>();
export function observeSlack<T>(work: () => Promise<T>, telemetry: SlackTelemetry): Promise<T> {
  return scope.run(telemetry, work);
}
export function recordRateLimit(retry: boolean): void {
  const state = scope.getStore();
  if (state) {
    state.rateLimits++;
    if (retry) {
      state.retries++;
    }
  }
}
