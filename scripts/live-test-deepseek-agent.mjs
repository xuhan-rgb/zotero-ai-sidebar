import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import http from "node:http";

const agentPort = 23121;
const callbackPort = 23122;
const token = "zai-live-deepseek-structure-test";
const taskID = `live-deepseek-${Date.now()}`;
const configPath = "/tmp/zai-live-deepseek-config.json";
const resultPath = "/tmp/zai-live-deepseek-result.json";
const prompt = [
  "请先进行思考，然后给出最终回答。",
  "最终回答必须包含：",
  "1. 二级标题“结构化回答”；",
  "2. 一个两列表格，表头为“项目”和“结果”；",
  "3. 最后一行必须是 STRUCTURE_TEST_END。",
  "最终回答不要复述思考过程。",
].join("\n");

await writeFile(
  configPath,
  JSON.stringify({
    token,
    nodePath: process.execPath,
    chromePath: "/usr/bin/google-chrome",
    agentScript: new URL("../web-agent/agent.mjs", import.meta.url).pathname,
    profileDir: "/home/qwer/.local/share/zotero-ai-sidebar/browser-profile",
    port: agentPort,
    callbackUrl: `http://127.0.0.1:${callbackPort}/callback`,
  }),
);

let finish;
let fail;
const completed = new Promise((resolve, reject) => {
  finish = resolve;
  fail = reject;
});
const callbacks = [];
let completionTimeout;
const callbackServer = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  callbacks.push(data);
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
  if (data.state === "completed") finish(data);
  if (data.state === "failed") fail(new Error(data.error || "DeepSeek failed"));
});
await new Promise((resolve) => callbackServer.listen(callbackPort, "127.0.0.1", resolve));

const agent = spawn(process.execPath, ["web-agent/agent.mjs", configPath], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: ["ignore", "pipe", "pipe"],
});
agent.stdout.on("data", (chunk) => process.stderr.write(chunk));
agent.stderr.on("data", (chunk) => process.stderr.write(chunk));
agent.once("exit", (code, signal) => {
  fail(
    new Error(
      `Live Web Agent exited before completion: code=${code}, signal=${signal}`,
    ),
  );
});

try {
  await waitForHealth();
  const queued = await fetch(`http://127.0.0.1:${agentPort}/tasks`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: taskID,
      provider: "deepseek",
      prompt,
      continuationPrompt: prompt,
      sessionKey: taskID,
      paperUrl: "",
      deepseekOptions: {
        mode: "expert",
        deepThinking: true,
        webSearch: false,
      },
    }),
  });
  if (!queued.ok) throw new Error(`Task enqueue failed: ${queued.status}`);
  const result = await Promise.race([
    completed,
    new Promise((_, reject) => {
      completionTimeout = setTimeout(
        () => reject(new Error("DeepSeek live test timed out")),
        360_000,
      );
    }),
  ]);
  clearTimeout(completionTimeout);
  await writeFile(resultPath, JSON.stringify({ result, callbacks }, null, 2));
  const answer = String(result.answer || "");
  const reasoning = String(result.reasoning || "");
  const checks = {
    reasoningPresent: reasoning.length > 0,
    answerPresent: answer.length > 0,
    separated: reasoning !== answer,
    headingPreserved: /^## 结构化回答$/m.test(answer),
    tablePreserved:
      /\|\s*项目\s*\|\s*结果\s*\|/.test(answer) &&
      /\|\s*---\s*\|\s*---\s*\|/.test(answer),
    complete: answer.trimEnd().endsWith("STRUCTURE_TEST_END"),
  };
  process.stdout.write(
    `${JSON.stringify(
      {
        checks,
        answerLength: answer.length,
        reasoningLength: reasoning.length,
        answerPreview: answer.slice(0, 500),
        reasoningPreview: reasoning.slice(0, 300),
        resultPath,
      },
      null,
      2,
    )}\n`,
  );
  if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
} finally {
  clearTimeout(completionTimeout);
  agent.kill("SIGTERM");
  callbackServer.closeAllConnections?.();
  await new Promise((resolve) => callbackServer.close(resolve));
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${agentPort}/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Live Web Agent did not start");
}
