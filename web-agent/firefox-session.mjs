import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

function sessionFile(profileDir) {
  return path.join(profileDir, "zai-session-cookies.json");
}

export async function saveFirefoxSessionCookies(context, profileDir) {
  const cookies = (await context.cookies()).filter(
    (cookie) => cookie.expires === -1,
  );
  const destination = sessionFile(profileDir);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(cookies), { mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function restoreFirefoxSessionCookies(context, profileDir) {
  const file = sessionFile(profileDir);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await context.addCookies(JSON.parse(raw));
  // Consume the snapshot so a later manual logout/close cannot replay old cookies.
  await unlink(file);
}
