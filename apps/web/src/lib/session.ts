import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/crypto";

const COOKIE_NAME = "slacki_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export async function createSession(userId: string): Promise<void> {
  const raw = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.query(
    "INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(raw), userId, expiresAt],
  );
  const jar = await cookies();
  jar.set(COOKIE_NAME, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function currentUser() {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) {return null;}
  const result = await db.query(
    `SELECT u.id, u.display_name, u.avatar_url
       FROM web_sessions s JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(raw)],
  );
  return result.rows[0] ?? null;
}
