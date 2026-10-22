// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  saveFirefoxSessionCookies,
  restoreFirefoxSessionCookies,
} from "../../web-agent/firefox-session.mjs";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
async function profile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zai-firefox-session-"));
  dirs.push(dir);
  return dir;
}
describe("Firefox session cookies", () => {
  it("saves session cookies privately and consumes them after restoration", async () => {
    const dir = await profile();
    const session = {
      name: "synthetic-session",
      value: "test-only",
      domain: "localhost",
      path: "/",
      expires: -1,
    };
    await saveFirefoxSessionCookies(
      {
        cookies: async () => [
          session,
          { ...session, name: "persistent", expires: 9999999999 },
        ],
      },
      dir,
    );
    const file = path.join(dir, "zai-session-cookies.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual([session]);
    if (process.platform !== "win32")
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    const addCookies = vi.fn(async () => {});
    await restoreFirefoxSessionCookies({ addCookies }, dir);
    expect(addCookies).toHaveBeenCalledWith([session]);
    await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
    await restoreFirefoxSessionCookies({ addCookies }, dir);
    expect(addCookies).toHaveBeenCalledOnce();
  });
  it("overwrites the snapshot after logout instead of replaying old cookies", async () => {
    const dir = await profile();
    await writeFile(
      path.join(dir, "zai-session-cookies.json"),
      '[{"name":"old-session"}]',
    );
    await saveFirefoxSessionCookies({ cookies: async () => [] }, dir);
    const addCookies = vi.fn(async () => {});
    await restoreFirefoxSessionCookies({ addCookies }, dir);
    expect(addCookies).toHaveBeenCalledWith([]);
  });
  it("preserves a snapshot if cookie restoration fails", async () => {
    const dir = await profile();
    const file = path.join(dir, "zai-session-cookies.json");
    await writeFile(file, "[]");
    await expect(
      restoreFirefoxSessionCookies(
        {
          addCookies: async () => {
            throw new Error("Disconnected");
          },
        },
        dir,
      ),
    ).rejects.toThrow("Disconnected");
    expect(await readFile(file, "utf8")).toBe("[]");
  });
});
