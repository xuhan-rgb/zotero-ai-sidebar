import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [configPath, nodePath, chromePath, agentScript, profileDir] = process.argv.slice(2);
if (!profileDir) throw new Error("Missing Web Agent config arguments");
let token = "";
let cdpPort = 9224;
try {
  const previous = JSON.parse(await readFile(configPath, "utf8"));
  token = previous.token ?? "";
  if (Number.isInteger(previous.cdpPort) && previous.cdpPort > 0) {
    cdpPort = previous.cdpPort;
  }
} catch {}
if (!token) token = randomBytes(32).toString("hex");
await mkdir(path.dirname(configPath), { recursive: true });
await mkdir(profileDir, { recursive: true });
await writeFile(
  configPath,
  `${JSON.stringify(
    {
      token,
      nodePath,
      chromePath,
      agentScript,
      profileDir,
      cdpPort,
      port: 23120,
      callbackUrl: "http://127.0.0.1:23119/zai/web-prompt-hub",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
