import { defineConfig } from "zotero-plugin-scaffold";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pkg from "./package.json";
import { buildWebAgentRuntimeRelease } from "./scripts/web-agent-runtime-archive";

const repository = pkg.repository.url
  .replace(/^git\+https:\/\/github\.com\//, "")
  .replace(/\.git$/, "");
const webAgentRuntime = await buildWebAgentRuntimeRelease({
  projectRoot: process.cwd(),
  runtimeVersion: pkg.version,
  protocolVersion: 24,
  repository,
});

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,

  build: {
    assets: ["addon/**/*.*"],
    hooks: {
      "build:copyAssets": async ({ dist }) => {
        const target = path.join(dist, webAgentRuntime.assetName);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, webAgentRuntime.archive);
      },
    },
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
          __webAgentRuntimeVersion__: JSON.stringify(pkg.version),
          __webAgentRuntimeProtocolVersion__: "24",
          __webAgentRuntimeAssetName__: JSON.stringify(
            webAgentRuntime.assetName,
          ),
          __webAgentRuntimeDownloadUrl__: JSON.stringify(
            webAgentRuntime.downloadUrl,
          ),
          __webAgentRuntimeReleaseUrl__: JSON.stringify(
            webAgentRuntime.releaseUrl,
          ),
          __webAgentRuntimeSha256__: JSON.stringify(webAgentRuntime.sha256),
          __webAgentRuntimeSize__: String(webAgentRuntime.size),
          "process.env.NODE_ENV": '"production"',
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
