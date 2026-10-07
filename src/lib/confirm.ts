import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export type ConsentResult = "yes" | "no" | "non_interactive";

/**
 * Ask the user a yes/no question on the terminal. Returns "non_interactive"
 * without prompting when stdin isn't a TTY or CI is detected, so automated
 * agents do not hang on a prompt.
 */
export async function askConsent(question: string): Promise<ConsentResult> {
  if (process.env.CI || !input.isTTY) {
    return "non_interactive";
  }
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes" ? "yes" : "no";
  } finally {
    rl.close();
  }
}
