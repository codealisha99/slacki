import type { Command } from "commander";
import type { CliContext } from "./context.ts";
import { startInboxUi } from "./ui-server.ts";
import { isSafeModeEnabled } from "./safe-mode.ts";

export function registerUiCommand(input: { program: Command; ctx: CliContext }): void {
  input.program
    .command("ui")
    .description("Open the local web app: inbox, channels, search, Later, doctor (127.0.0.1 only)")
    .option(
      "--workspace <url>",
      "Workspace selector (full URL or unique substring; needed when you have multiple workspaces)",
    )
    .option("--port <n>", "Listen port (default 8787; 0 picks a free port)")
    .option("--no-open", "Print the URL and do not open a browser")
    .action(async (options: { workspace?: string; port?: string; open?: boolean }) => {
      try {
        const portRaw = options.port === undefined ? 8787 : Number.parseInt(options.port, 10);
        if (!Number.isFinite(portRaw) || portRaw < 0) {
          throw new Error(`Invalid --port value "${options.port}"`);
        }
        const running = await startInboxUi({
          ctx: input.ctx,
          workspaceUrl: input.ctx.effectiveWorkspaceUrl(options.workspace),
          port: portRaw,
          openBrowser: options.open !== false,
          cliSafeMode: isSafeModeEnabled({
            cliFlag: Boolean(input.program.opts().safeMode),
          }),
        });
        process.stderr.write("slacki web app is local-only. Ctrl+C to stop.\n");
        await new Promise<void>((resolve) => {
          const stop = async () => {
            await running.close();
            resolve();
          };
          process.once("SIGINT", () => {
            void stop();
          });
          process.once("SIGTERM", () => {
            void stop();
          });
        });
      } catch (err: unknown) {
        console.error(input.ctx.errorMessage(err));
        process.exitCode = 1;
      }
    });
}
