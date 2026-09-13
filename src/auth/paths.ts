import { homedir } from "node:os";
import { join } from "node:path";

export const SLACKI_DIR = join(homedir(), ".config", "slacki");
export const CREDENTIALS_FILE = join(SLACKI_DIR, "credentials.json");
export const KEYCHAIN_SERVICE = "slacki";
